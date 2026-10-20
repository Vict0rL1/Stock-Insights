from __future__ import annotations

from contextlib import asynccontextmanager

import math

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import settings
from app.db.engine import SessionLocal, init_db
from app.mantenimiento import mantener
from app.registro import configurar as configurar_registro
from app.routers import (
    deep_dive,
    empresa,
    expectativas,
    earnings,
    etfs,
    market,
    meta,
    news,
    options,
    portfolio,
    screener,
    signals,
    snapshots,
    stocks,
    theses,
    valuation,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configurar_registro()
    init_db()
    # Limpieza al arrancar. `mantener` no lanza: un fallo aquí no puede
    # impedir que la app arranque.
    mantener(SessionLocal)
    yield


app = FastAPI(
    title="Análisis Bursátil",
    description=(
        "API local de investigación de acciones y ETFs. No da señales de "
        "compra ni predicciones: toda cifra lleva fuente y fecha."
    ),
    lifespan=lifespan,
)



def _sin_no_finitos(valor):
    """Sustituye NaN e infinitos por su texto, para que se puedan serializar."""
    if isinstance(valor, float) and not math.isfinite(valor):
        return str(valor)
    if isinstance(valor, dict):
        return {k: _sin_no_finitos(v) for k, v in valor.items()}
    if isinstance(valor, (list, tuple)):
        return [_sin_no_finitos(v) for v in valor]
    return valor


@app.exception_handler(RequestValidationError)
async def _error_de_validacion(request: Request, exc: RequestValidationError) -> JSONResponse:
    """El 422 de siempre, pero que no revienta con un `Infinity` dentro.

    FastAPI devuelve en el error el valor recibido. Si ese valor era `Infinity`
    —que el `json` de Python acepta al leer pero no al escribir— el propio
    mensaje de error fallaba al serializarse y el cliente recibía un 500: el
    rechazo correcto se convertía en un fallo del servidor.
    """
    errores = exc.errors()
    # Un ticker que no cumple el patrón común (app/simbolos.py) se explica en
    # español; el mensaje de Pydantic («String should match pattern …») no
    # le dice nada a quien usa la app.
    from app.simbolos import mensaje_invalido

    for e in errores:
        if e.get("type") == "string_pattern_mismatch" and any("symbol" in str(p) for p in e.get("loc", ())):
            e["msg"] = mensaje_invalido(e.get("input"))
    return JSONResponse(
        status_code=422,
        content={"detail": jsonable_encoder(_sin_no_finitos(errores))},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


def nombre_de_host(cabecera: str | None) -> str | None:
    """«localhost:5173» → «localhost»; «[::1]:8000» → «[::1]». None si no se lee."""
    texto = (cabecera or "").strip().lower()
    if texto.startswith("["):
        fin = texto.find("]")
        resto = texto[fin + 1:] if fin > 1 else None
        return texto[: fin + 1] if resto is not None and (resto == "" or resto.startswith(":")) else None
    if texto.count(":") > 1:
        return None
    return texto.partition(":")[0] or None


class HostDeConfianza:
    """Rechaza con un 400 la petición cuya cabecera `Host` no es de esta máquina.

    Es lo que hace `TrustedHostMiddleware` de Starlette, con dos diferencias: el
    motivo va en español y en `detail`, como cualquier error de la API, y se
    compara sin distinguir mayúsculas (un nombre de host no las distingue). Antes
    se aceptaba cualquier `Host` (auditoría del 19 oct).
    """

    def __init__(self, app: ASGIApp, permitidos: list[str]) -> None:
        self.app = app
        self.permitidos = {p.strip().lower() for p in permitidos}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket"):
            cabecera = dict(scope.get("headers") or []).get(b"host", b"").decode("latin-1")
            if nombre_de_host(cabecera) not in self.permitidos:
                respuesta = JSONResponse(status_code=400, content={"detail": (
                    f"Cabecera Host no permitida: «{cabecera[:80]}». El backend solo atiende a "
                    f"{', '.join(sorted(self.permitidos))}; para llamarlo con otro nombre, añádelo a "
                    "ALLOWED_HOSTS en .env.")})
                await respuesta(scope, receive, send)
                return
        await self.app(scope, receive, send)


# La última en añadirse es la de fuera: el Host se comprueba antes que nada.
app.add_middleware(HostDeConfianza, permitidos=settings.allowed_hosts)

app.include_router(stocks.router)
app.include_router(market.router)
app.include_router(news.router)
app.include_router(etfs.router)
app.include_router(screener.router)
app.include_router(portfolio.router)
app.include_router(portfolio.watchlist_router)
app.include_router(theses.router)
app.include_router(signals.router)
app.include_router(deep_dive.router)
app.include_router(earnings.router)
app.include_router(valuation.router)
app.include_router(snapshots.router)
app.include_router(empresa.router)
app.include_router(expectativas.router)
app.include_router(options.router)
app.include_router(meta.router)

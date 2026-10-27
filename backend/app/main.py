from __future__ import annotations

from contextlib import asynccontextmanager

import math

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import HOSTS_DE_ESTA_MAQUINA, settings
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


def _puerto(direccion: str) -> str | None:
    """«localhost:5173» → «5173»; «[::1]:8000» → «8000»; sin puerto, None."""
    resto = direccion.rpartition("]")[2] if direccion.startswith("[") else direccion
    _, dos_puntos, puerto = resto.rpartition(":")
    return puerto if dos_puntos and puerto else None


class HostDeConfianza:
    """Solo atiende a esta máquina: por su cabecera `Host` y por su origen.

    - `Host` que no es de esta máquina → 400. Es lo que hace
      `TrustedHostMiddleware` de Starlette, con el motivo en español y en
      `detail`, y sin distinguir mayúsculas. Antes se aceptaba cualquier `Host`
      (auditoría del 19 oct): DNS rebinding.
    - Petición que viene de otra web → 403. El `Host` de una web que llama a
      `http://127.0.0.1:8000` es el nuestro, y CORS solo impide LEER la
      respuesta, no que se ejecute: un `<img>` hacia `/api/empresa/AAPL/analisis`
      congelaba una instantánea inmutable y gastaba cuota de los proveedores
      (revisión de A6). Vale `Sec-Fetch-Site: same-origin`, que pone el
      navegador y ninguna página puede falsificar (la interfaz por el proxy de
      Vite en cualquier puerto: `npm run preview`, o el 5174 con el 5173
      ocupado, recibían 403 en todo POST; revisión 3); vale un `Origin` de la
      interfaz local (`CORS_ORIGINS`, o su puerto con un nombre permitido) o del
      propio backend (`/docs`). Sin `Origin`, un `Sec-Fetch-Site` de otro sitio
      se rechaza, y sin ninguno de los dos (un nombre de ALLOWED_HOSTS en http no
      recibe Fetch Metadata) se mira el `Referer`.
    """

    def __init__(self, app: ASGIApp, permitidos: list[str], origenes: list[str]) -> None:
        self.app = app
        self.permitidos = {p.strip().lower() for p in permitidos}
        self.origenes = {o.strip().lower().rstrip("/") for o in origenes}
        self.puertos_de_la_interfaz = {_puerto(o.partition("://")[2]) for o in self.origenes} - {None}

    def _origen_permitido(self, origen: str, host: str) -> bool:
        origen = origen.strip().lower().rstrip("/")
        if origen in self.origenes:
            return True
        esquema, _, direccion = origen.partition("://")
        if esquema not in ("http", "https") or not direccion or "/" in direccion:
            return False  # «null» (un iframe aislado, un fichero local) no es un origen de aquí
        if direccion == host.strip().lower():
            return True
        return nombre_de_host(direccion) in self.permitidos and _puerto(direccion) in self.puertos_de_la_interfaz

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket"):
            cabeceras = dict(scope.get("headers") or [])
            cabecera = cabeceras.get(b"host", b"").decode("latin-1")
            origen = cabeceras.get(b"origin")
            sitio = cabeceras.get(b"sec-fetch-site", b"").decode("latin-1").strip().lower()
            referer = cabeceras.get(b"referer", b"").decode("latin-1").strip()
            respuesta = None
            ajena = None
            if nombre_de_host(cabecera) not in self.permitidos:
                respuesta = JSONResponse(status_code=400, content={"detail": (
                    f"Cabecera Host no permitida: «{cabecera[:80]}». El backend solo atiende a "
                    f"{', '.join(sorted(self.permitidos))}; para llamarlo con otro nombre, añádelo a "
                    "ALLOWED_HOSTS en .env.")})
            elif sitio == "same-origin":
                pass
            elif origen is not None:
                if not self._origen_permitido(origen.decode("latin-1"), cabecera):
                    ajena = f"«{origen.decode('latin-1')[:80]}»"
            elif sitio in ("cross-site", "same-site"):
                ajena = f"Sec-Fetch-Site: {sitio}"
            elif not sitio and referer:
                esquema, _, resto = referer.partition("://")
                if not self._origen_permitido(f"{esquema}://{resto.split('/', 1)[0]}", cabecera):
                    ajena = f"Referer «{referer[:80]}»"
            if ajena:
                respuesta = JSONResponse(status_code=403, content={"detail": (
                    f"Petición de otra web ({ajena}): el backend solo atiende a la interfaz de esta "
                    "máquina. Si es tu interfaz servida en otro puerto o con otro nombre, añade su origen a "
                    "CORS_ORIGINS en .env (lista JSON).")})
            if respuesta is not None:
                await respuesta(scope, receive, send)
                return
        await self.app(scope, receive, send)


# La última en añadirse es la de fuera: el Host y el origen se comprueban antes
# que nada, también antes que CORS.
app.add_middleware(HostDeConfianza, permitidos=[*HOSTS_DE_ESTA_MAQUINA, *settings.allowed_hosts],
                   origenes=settings.cors_origins)

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

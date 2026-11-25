"""«Pregúntale a la IA»: una pregunta libre sobre lo que la app ya calculó.

El router solo ensambla: el contexto, el prompt y la caché de respuestas viven
en `app/pregunta_ia.py` y `app/llm/pregunta_llm.py`. Como el resto de la IA de
la app, solo corre cuando alguien pulsa, enseña antes lo que costaría
(`/preguntar/coste`, sin llamar al modelo) y la respuesta viaja marcada como IA.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app import pregunta_ia
from app.cache.cache import MarketDataService
from app.db.engine import get_session
from app.deps import get_llm, get_service
from app.formato import fmt_num
from app.llm.base import LLMProvider, LLMUnavailableError
from app.llm.pregunta_llm import MAX_PREGUNTA, limpiar_pregunta
from app.simbolos import SimboloOpcional

router = APIRouter(prefix="/api/ia", tags=["ia"])

SIN_CLAVE = (
    "Capa de IA no configurada: añade ANTHROPIC_API_KEY en el archivo .env de la carpeta del "
    "proyecto y reinicia la app con ./start.sh. Sin ella no se puede preguntar a la IA; el resto "
    "de la app funciona igual."
)


class _Contexto(BaseModel):
    mercado: str | None = Field(None, validate_default=True,
                                 description="Mercado de la lista del día; por defecto, el S&P 500")
    simbolo: SimboloOpcional = Field(None, description="Empresa cuya ficha ya calculada entra en el contexto")

    @field_validator("mercado")
    @classmethod
    def _mercado(cls, v: str | None) -> str:
        return pregunta_ia.mercado_valido(v)


def _longitud(v: str) -> str:
    n = len(v.strip())
    if n > MAX_PREGUNTA:
        raise ValueError(
            f"La pregunta es demasiado larga: {fmt_num(n, 0)} caracteres, y el máximo es "
            f"{fmt_num(MAX_PREGUNTA, 0)}. Acórtala: la IA contesta con los datos de la app, no con un texto pegado."
        )
    return v


class PreguntaRequest(_Contexto):
    pregunta: str = Field(..., description=f"La pregunta, {MAX_PREGUNTA} caracteres como mucho")

    @field_validator("pregunta")
    @classmethod
    def _pregunta(cls, v: str) -> str:
        if not limpiar_pregunta(v):
            raise ValueError("Escribe una pregunta (o toca una de las sugerencias).")
        return _longitud(v)


class CosteRequest(_Contexto):
    pregunta: str = Field("", description="La pregunta, si ya está escrita; vacía, se estima el contexto solo")

    @field_validator("pregunta")
    @classmethod
    def _pregunta(cls, v: str) -> str:
        return _longitud(v)


def _exigir_ia(llm: LLMProvider | None) -> LLMProvider:
    """La IA, o un 503 que dice cómo encenderla (sin ella, `None.interpret` era un 500)."""
    if llm is None:
        raise HTTPException(status_code=503, detail=SIN_CLAVE)
    return llm


@router.post("/preguntar/coste")
def coste(
    request: CosteRequest,
    llm: LLMProvider | None = Depends(get_llm),
    service: MarketDataService = Depends(get_service),
    session: Session = Depends(get_session),
):
    """Qué datos se le pasarían a la IA y cuánto costaría, sin llamar al modelo."""
    llm = _exigir_ia(llm)
    contexto = pregunta_ia.reunir(session, service, mercado=request.mercado, simbolo=request.simbolo)
    return pregunta_ia.estimar(llm, request.pregunta, contexto)


@router.post("/preguntar")
def preguntar(
    request: PreguntaRequest,
    llm: LLMProvider | None = Depends(get_llm),
    service: MarketDataService = Depends(get_service),
    session: Session = Depends(get_session),
):
    """La respuesta de Claude con lo ya calculado del día, marcada como IA."""
    llm = _exigir_ia(llm)
    contexto = pregunta_ia.reunir(session, service, mercado=request.mercado, simbolo=request.simbolo)
    try:
        return pregunta_ia.responder(llm, session, request.pregunta, contexto)
    except LLMUnavailableError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

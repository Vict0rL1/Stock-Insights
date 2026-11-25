"""Interfaz de la capa de interpretación por LLM.

Principios que esta capa impone por diseño:
- El LLM NUNCA se llama automáticamente: solo cuando el usuario lo pide
  (botón explícito). Eso minimiza el gasto en el API de Anthropic.
- Toda salida se registra en la tabla llm_outputs y viaja marcada como
  generada por IA — jamás se mezcla con lo calculado a partir de datos.
- El proveedor es intercambiable (Anthropic hoy; otro mañana) sin tocar
  los endpoints.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.llm.coste import coste_declinado


class LLMUnavailableError(Exception):
    """El proveedor no está configurado o rechazó la petición."""


class ModeloDeclino(LLMUnavailableError):
    """El modelo (y, con el respaldo del servidor, también el de respaldo)
    declinó la petición: no hay respuesta, pero lo gastado se pudo cobrar.

    Lleva el uso de cada intento (`uso`, con la forma de `anthropic_provider._uso`)
    y el mensaje ya dice lo gastado (`coste.coste_declinado`): antes el uso se
    tiraba con la respuesta y el 502 de «Pregúntale a la IA» decía solo «El
    modelo declinó…», sin cifra ni «no se sabe» (revisión 15, H6). Quien la
    atrapa como `LLMUnavailableError` enseña el mensaje y ya lo dice."""

    def __init__(self, motivo: str, uso: dict | None, modelo: str | None):
        self.motivo = motivo
        self.uso = uso
        self.modelo = modelo
        self.coste = coste_declinado(uso, modelo)
        super().__init__(f"{motivo}. {self.coste['nota']}")


class LLMProvider(ABC):
    # El modelo con el que se llama (p. ej. «claude-sonnet-5-5»): con él se
    # estima el coste antes de gastarlo. None = no se sabe, y entonces no se estima.
    model: str | None = None

    name: str = "base"

    @abstractmethod
    def interpret(self, system: str, prompt: str) -> dict:
        """-> {content: str (markdown), model: str, usage?: {entrada, salida}}

        `usage` es opcional: un proveedor que no da el recuento de tokens no lo
        trae, y quien enseña el coste dice entonces que no se conoce."""
        ...

    def extract(self, system: str, prompt: str, schema: type) -> dict:
        """Extracción con forma FIJA -> {data: dict, model: str, usage: dict}.

        `schema` es un modelo Pydantic. La diferencia con `interpret` no es de
        formato sino de propósito: `interpret` produce prosa para leer, esto
        produce campos para comparar en el tiempo. Un análisis de resultados solo
        sirve si el de este trimestre tiene exactamente la misma forma que el del
        anterior, y eso no se consigue pidiendo JSON por favor en el prompt.
        """
        raise LLMUnavailableError(f"{self.name} no ofrece extracción estructurada")

    def contar_tokens(self, system: str, prompt: str) -> int | None:
        """Tokens de entrada ANTES de llamar, para poder enseñar el coste.

        Devuelve None si el proveedor no sabe contar: quien llama debe distinguir
        «no se pudo estimar» de «sale gratis».
        """
        return None

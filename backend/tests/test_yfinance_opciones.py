"""La cadena de opciones de yfinance: «no cotiza opciones» solo cuando de verdad
no tiene vencimientos (segunda revisión del 2.1).

Antes, una cadena que fallaba a mitad (un 429 en cada vencimiento, una respuesta
vacía) o sin precio de la acción salía como DataNotFoundError, y la ficha decía
«AAPL no cotiza opciones» sin «Reintentar»: un fallo pintado como ausencia.
"""

from __future__ import annotations

from types import SimpleNamespace

import pandas as pd
import pytest

from app.providers.base import DataNotFoundError, ProviderError
from app.providers.yfinance_provider import YFinanceProvider


def _proveedor(monkeypatch, ticker) -> YFinanceProvider:
    p = YFinanceProvider()
    monkeypatch.setattr(p, "_ticker", lambda symbol: ticker)
    return p


def _df(strike=100.0):
    return pd.DataFrame([{"strike": strike, "impliedVolatility": 0.3, "bid": 1.0, "ask": 1.2,
                          "volume": 10, "openInterest": 100, "lastTradeDate": None}])


# Guarda de no regresión (pasa también con el código anterior): lo que de
# verdad no cotiza opciones sigue siendo una ausencia.
def test_sin_vencimientos_no_cotiza_opciones(monkeypatch):
    p = _proveedor(monkeypatch, SimpleNamespace(options=()))
    with pytest.raises(DataNotFoundError, match="no cotiza opciones"):
        p.get_options_chain("SHOP.TO")


def test_vencimientos_que_fallan_todos_son_un_fallo_no_una_ausencia(monkeypatch):
    def falla(venc):
        raise RuntimeError("429 Too Many Requests")

    p = _proveedor(monkeypatch, SimpleNamespace(options=("2026-10-17", "2026-11-21"), option_chain=falla))
    with pytest.raises(ProviderError, match="2 vencimientos y no llegó ningún contrato") as e:
        p.get_options_chain("AAPL")
    assert not isinstance(e.value, DataNotFoundError)


def test_una_respuesta_vacia_en_cada_vencimiento_tambien_es_un_fallo(monkeypatch):
    vacia = SimpleNamespace(calls=None, puts=None, underlying={})
    p = _proveedor(monkeypatch, SimpleNamespace(options=("2026-10-17",), option_chain=lambda v: vacia))
    with pytest.raises(ProviderError) as e:
        p.get_options_chain("AAPL")
    # DataNotFoundError hereda de ProviderError: hay que descartarlo a mano.
    assert not isinstance(e.value, DataNotFoundError)


def test_sin_precio_de_la_accion_el_spot_queda_desconocido(monkeypatch):
    """Sin `underlying` ni cotización: spot `None` (la ruta responde 502), no
    «no cotiza opciones»."""
    cadena = SimpleNamespace(calls=_df(), puts=_df(), underlying={})
    p = _proveedor(monkeypatch, SimpleNamespace(options=("2026-10-17",), option_chain=lambda v: cadena))

    def sin_cotizacion(symbol):
        raise DataNotFoundError("yfinance: sin cotización para AAPL")

    monkeypatch.setattr(p, "get_quote", sin_cotizacion)
    r = p.get_options_chain("AAPL")
    assert r["spot"] is None and len(r["contratos"]) == 2

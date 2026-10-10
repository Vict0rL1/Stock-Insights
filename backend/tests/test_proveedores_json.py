"""Un 200 que no es JSON es un fallo del proveedor, no una excepción suelta.

Una página de mantenimiento o de un proxy llega con 200 y HTML. Finnhub ya lo
convertía en `ProviderError`; FRED, EDGAR y Twelve Data dejaban subir un
`ValueError` que ni el router ni el servicio capturan. Con efectivo en CAD y
posiciones abiertas, eso tumbaba la lista de Hoy entera con un 500 después de
puntuar todo el mercado (revisión de M3, 9-oct-2026).
"""

from __future__ import annotations

import httpx
import pytest

from app.providers.base import ProviderError
from app.providers.edgar import EdgarProvider
from app.providers.fred import FredProvider
from app.providers.twelvedata import TwelveDataProvider


@pytest.fixture
def pagina_html(monkeypatch):
    def get(url, **_):
        return httpx.Response(200, text="<html>En mantenimiento</html>", request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", get)


def test_fred_con_una_pagina_html_es_un_fallo_del_proveedor(pagina_html):
    with pytest.raises(ProviderError, match="ilegible"):
        FredProvider(api_key="x").get_macro("DEXCAUS", "2026-01-01")


def test_edgar_con_una_pagina_html_es_un_fallo_del_proveedor(pagina_html):
    with pytest.raises(ProviderError, match="no es JSON"):
        EdgarProvider(user_agent="Prueba prueba@example.com")._get("https://data.sec.gov/x.json")


def test_twelvedata_con_una_pagina_html_es_un_fallo_del_proveedor(pagina_html):
    with pytest.raises(ProviderError, match="no es JSON"):
        TwelveDataProvider(api_key="x")._get("/time_series", {"symbol": "AAPL"})


def test_fred_con_una_observacion_rota_es_un_fallo_del_proveedor(monkeypatch):
    def get(url, **_):
        return httpx.Response(200, json={"observations": [{"value": "1.3"}]}, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", get)
    with pytest.raises(ProviderError, match="observación ilegible"):
        FredProvider(api_key="x").get_macro("DEXCAUS", "2026-01-01")

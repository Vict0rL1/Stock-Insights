"""Módulo de valoración: DCF por escenarios, DCF inverso y comparables ajustados.

Las cuatro piezas contestan preguntas distintas y ninguna es suficiente sola:

1. **DCF por escenarios** — «¿cuánto vale si pasa esto?». Supuestos visibles y
   editables, y cada escenario devuelve un RANGO.
2. **DCF inverso** — «¿qué hay que creerse para que el precio de hoy sea
   correcto?». Es la más útil de las cuatro, porque no exige acertar un número:
   exige juzgar si lo que el precio descuenta es plausible.
3. **Comparables ajustados por crecimiento y calidad** — «¿cotiza donde cotizan
   empresas parecidas *de verdad*?», que no es lo mismo que compararla con la
   mediana del sector.
4. **Sensibilidad ordenada** — «¿qué supuesto decide el resultado?». Casi
   siempre es el WACC o el crecimiento a perpetuidad, y saberlo cambia dónde se
   pone el esfuerzo.

**Ningún endpoint de este módulo devuelve un precio objetivo único.** No es una
convención de presentación: no existe en el código ningún campo que contenga uno.
Los escenarios devuelven `bajo/centro/alto`, los comparables devuelven un
intervalo de predicción y el DCF inverso devuelve una curva. Si algún día alguien
quiere enseñar un número solo, tendrá que escribir la línea que lo colapse, y
entonces será una decisión visible en un diff en vez de un descuido.

Coste: el DCF y el inverso son aritmética local, cero llamadas. Los comparables
reutilizan `peers` (cacheado 7 días) y `fundamentals` de hasta 6 pares (24 h).

Es el único DCF de la app (ítem 3.3): la pestaña Valoración de la ficha enseña
un resumen de esta misma respuesta y el informe completo calcula sus escenarios
con las mismas funciones (`app/analysis/valuation.py`). La lógica de dominio
vive allí; aquí solo se reúnen los datos y se arma la respuesta.
"""

from __future__ import annotations

from app.datos import numero as datos_numero


from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.analysis.fundamentals import nota_deuda_parcial
from app.analysis.relative_value import (
    ajustar_por_crecimiento_y_calidad,
    rango_de_precio_implicito,
)
from app.analysis.reverse_dcf import (
    curva_de_crecimiento_implicito,
    juzgar_contra_el_pasado,
    margen_implicito,
    resumen as resumen_inverso,
)
from app.analysis.valuation import (
    ANOS,
    CRECIMIENTO_MAXIMO,
    CRECIMIENTO_MINIMO,
    CRECIMIENTO_SUPUESTO,
    cimientos,
    escenarios_con_rango,
    rango_global,
    sensibilidad_ordenada,
    supuestos_con_procedencia,
)
from app.cache.cache import MarketDataService
from app.db.engine import get_session
from app.deps import get_service
from app.formato import fmt_pct
from app.providers.base import DataNotFoundError
from app.providers.router import AllProvidersFailedError
from app.simbolos import SimboloRuta, validar_simbolo

router = APIRouter(prefix="/api/valuation", tags=["valuation"])

MAX_PARES = 6


class Escenario(BaseModel):
    # El mismo suelo con que se proponen: lo que la app propone, la app lo acepta.
    growth_rate: float = Field(ge=CRECIMIENTO_MINIMO, le=1.0)
    discount_rate: float = Field(gt=0.0, le=0.40)
    terminal_growth: float = Field(ge=-0.02, le=0.06)


class ValoracionRequest(BaseModel):
    """Todo opcional: sin cuerpo, la app propone supuestos desde el histórico."""

    escenarios: dict[str, Escenario] | None = None
    years: int = Field(ANOS, ge=3, le=10)
    base_fcf: float | None = None
    net_debt: float | None = None
    # Unas acciones escritas tienen que ser positivas: un 0 enviado se cambiaba en
    # silencio por las del filing (`x or valor`) y se valoraba con ellas como si
    # fueran las tuyas (revisión 15, H11).
    shares_outstanding: float | None = Field(None, gt=0)



def _traer(service: MarketDataService, tipo: str, **kw):
    try:
        return service.get(tipo, **kw)
    except (DataNotFoundError, AllProvidersFailedError):
        return None


def _cimientos(service: MarketDataService, symbol: str) -> dict:
    """Los datos reales sobre los que se monta todo, con su procedencia."""
    # 404 solo si EDGAR no lo tiene; si no respondió, 502, como el informe
    # completo. `_traer` se tragaba los dos, y con EDGAR caído la pestaña
    # Valoración de la ficha decía que la empresa «no presenta 10-K»: una
    # ausencia, sin «Reintentar». El alias viejo de la ficha ya daba 502
    # (revisión 15, H2; la misma clase que la segunda revisión del 2.1).
    try:
        financials = service.get("financials", symbol=symbol)
    except DataNotFoundError:
        financials = None
    except AllProvidersFailedError as exc:
        raise HTTPException(
            status_code=502, detail=f"No se pudieron descargar los estados financieros de EDGAR: {exc}"
        ) from exc
    if not financials or not financials.get("periods"):
        raise HTTPException(
            status_code=404,
            detail=(
                f"Sin estados financieros de la SEC para {symbol}. Las empresas no "
                "estadounidenses y los ETFs no presentan 10-K, así que la valoración "
                "por DCF no las cubre."
            ),
        )
    quote = _traer(service, "quote", symbol=symbol)
    return {
        **cimientos(financials["periods"]),
        "periodos": financials["periods"],
        "precio": (quote or {}).get("price"),
        "source": financials.get("source", "edgar"),
    }


def _comparables(service: MarketDataService, symbol: str, precio: float | None, eps: float | None) -> dict:
    """Valoración relativa ajustada, con los pares que se puedan reunir."""
    peers = _traer(service, "peers", symbol=symbol)
    if not peers or not peers.get("peers"):
        return {
            "disponible": False,
            "nota": f"Sin lista de comparables para {symbol}.",
        }

    filas = []
    for sym in [symbol, *peers["peers"][:MAX_PARES]]:
        f = _traer(service, "fundamentals", symbol=sym)
        if not f:
            continue
        m = f["metrics"]
        filas.append(
            {
                "symbol": sym,
                "multiplo": m.get("pe_ttm"),
                "crecimiento": m.get("revenue_growth_5y"),
                "calidad": m.get("roe"),
            }
        )

    objetivo = next((f for f in filas if f["symbol"] == symbol), None)
    if objetivo is None:
        return {"disponible": False, "nota": f"Sin fundamentales del propio {symbol}."}

    ajuste = ajustar_por_crecimiento_y_calidad(filas, objetivo, etiqueta_multiplo="P/E")
    salida = {**ajuste, "fuente_pares": peers.get("source")}

    # El BPA tiene que ser el COHERENTE con el múltiplo, no el de otra fuente.
    #
    # Los P/E de los pares vienen del proveedor de fundamentales (TTM, ajustado);
    # el BPA de EDGAR es anual y GAAP. Mezclarlos daba un resultado que se
    # contradecía a sí mismo dentro del mismo panel: el P/E salía FUERA del
    # intervalo y el precio implícito, DENTRO. Los dos números eran correctos por
    # separado y juntos no querían decir nada, porque cada uno vivía en un espacio
    # de múltiplos distinto. Se despeja el BPA del propio múltiplo del objetivo,
    # y entonces las dos lecturas coinciden siempre por construcción.
    eps_coherente = (
        precio / objetivo["multiplo"]
        if precio and objetivo.get("multiplo")
        else eps
    )

    if ajuste.get("disponible") and ajuste.get("fiable") and ajuste.get("intervalo"):
        salida["precio_implicito"] = rango_de_precio_implicito(
            ajuste["intervalo"]["bajo"], ajuste["intervalo"]["alto"], eps_coherente, precio
        )
    elif ajuste.get("crudo") and eps_coherente:
        # Sin ajuste fiable, el rango sale de los cuartiles crudos de los pares y
        # se marca como NO ajustado. Enseñar el cuartil disfrazado de ajuste sería
        # lo mismo que no tener el módulo.
        salida["precio_implicito"] = {
            **rango_de_precio_implicito(
                ajuste["crudo"]["p25"], ajuste["crudo"]["p75"], eps_coherente, precio
            ),
            "ajustado": False,
            "aviso": (
                "Este rango sale del cuartil 25-75 de los múltiplos de los pares SIN "
                "ajustar por crecimiento ni calidad, porque el ajuste no salió "
                "fiable. Vale menos que uno ajustado y conviene leerlo sabiéndolo."
            ),
        }
    return salida


@router.post("/{symbol}")
def valorar(
    symbol: SimboloRuta,
    request: ValoracionRequest = Body(default_factory=ValoracionRequest),
    service: MarketDataService = Depends(get_service),
    session: Session = Depends(get_session),
):
    """Las cuatro valoraciones a la vez, con supuestos visibles y editables.

    Sin cuerpo, la app propone los escenarios desde el histórico de la empresa.
    Con cuerpo, manda lo que envíes: es tu tesis, no la suya.
    """
    symbol = validar_simbolo(symbol)
    datos = _cimientos(service, symbol)

    base_fcf = request.base_fcf if request.base_fcf is not None else datos["base_fcf"]
    net_debt = request.net_debt if request.net_debt is not None else datos["net_debt"]
    acciones = (
        request.shares_outstanding if request.shares_outstanding is not None
        else datos_numero(datos["shares_outstanding"])
    )
    if base_fcf is None:
        raise HTTPException(
            status_code=422,
            detail=(
                "No se pudo calcular el flujo de caja libre del último ejercicio "
                "(faltan flujo operativo o capex en el filing). Puedes escribirlo tú "
                "en el campo de FCF de partida si lo tienes."
            ),
        )
    # Mismo patrón para la deuda y las acciones: sin ellas no hay valor por
    # acción, y lo honesto es decirlo y ofrecer el arreglo, no rellenar el
    # hueco con el supuesto más favorable.
    if net_debt is None:
        raise HTTPException(
            status_code=422,
            detail=(
                "No se conoce la deuda neta de la empresa (el filing no trae deuda "
                "a largo ni a corto plazo). Sin ella no hay valor por acción: "
                "suponerla cero la valoraría como si no debiera nada. Puedes "
                "escribirla tú en el campo de deuda neta si la conoces."
            ),
        )
    # Las del filing pueden faltar o venir a cero: sin acciones no hay valor por acción.
    if acciones is None or acciones <= 0:
        raise HTTPException(
            status_code=422,
            detail=(
                "No se conoce el número de acciones en circulación, así que no hay "
                "valor por acción. Puedes escribirlo tú en el campo de acciones en "
                "circulación si lo conoces."
            ),
        )

    supuestos = supuestos_con_procedencia(
        datos["crecimiento"],
        {k: v.model_dump() for k, v in request.escenarios.items()} if request.escenarios else None,
        base_fcf,
    )

    # 1) Escenarios, cada uno con su RANGO, y el rango global de todos.
    escenarios = escenarios_con_rango(supuestos, base_fcf, net_debt, acciones, request.years)
    global_ = rango_global(escenarios, datos["precio"])

    # 2) Sensibilidad ordenada sobre el escenario base.
    base = supuestos.get("base") or next(iter(supuestos.values()))
    sensibilidad = sensibilidad_ordenada(
        base_fcf, base["growth_rate"], base["discount_rate"], base["terminal_growth"],
        request.years, net_debt, acciones,
    )

    # 3) DCF inverso.
    market_cap = (datos["precio"] * acciones) if datos["precio"] and acciones else None
    if market_cap:
        curva = curva_de_crecimiento_implicito(
            market_cap=market_cap, base_fcf=base_fcf,
            terminal_growth=base["terminal_growth"], years=request.years, net_debt=net_debt,
        )
        contraste = juzgar_contra_el_pasado(curva, datos["crecimiento"])
        # El crecimiento de ingresos con el que se despeja el margen: el MEDIDO,
        # y si no lo hay, el supuesto DECLARADO. Antes era `revenue_cagr or 0.03`:
        # un 0,0 real se convertía en 3 % por ser *falsy*, y la ausencia del dato
        # en un 3 % que nadie veía.
        medido = datos_numero(datos["crecimiento"].get("revenue_cagr"))
        crecimiento_ingresos = (
            {"valor": medido, "supuesto": False}
            if medido is not None
            else {"valor": CRECIMIENTO_SUPUESTO, "supuesto": True,
                  "motivo": "sin crecimiento histórico de ingresos medible: supuesto del 3\u00a0%"}
        )
        margen = (
            margen_implicito(
                market_cap=market_cap, revenue=datos["revenue"],
                margen_actual=base_fcf / datos["revenue"],
                revenue_growth=crecimiento_ingresos["valor"],
                discount_rate=base["discount_rate"],
                terminal_growth=base["terminal_growth"],
                years=request.years, net_debt=net_debt,
            )
            if datos["revenue"]
            else {"disponible": False, "motivo": "Sin ingresos en el último ejercicio."}
        )
        if margen.get("disponible"):
            margen["crecimiento_de_ingresos"] = crecimiento_ingresos
            if crecimiento_ingresos["supuesto"]:
                margen["nota"] += " Ese crecimiento es un SUPUESTO: la empresa no tiene histórico de ingresos medible."
        inverso = {
            "disponible": True,
            "market_cap": market_cap,
            "curva": curva,
            "contraste": contraste,
            "margen": margen,
            "resumen": resumen_inverso(curva, margen, contraste),
        }
    else:
        inverso = {
            "disponible": False,
            "nota": (
                "Sin precio o sin número de acciones no hay capitalización, y sin "
                "capitalización no hay nada que invertir."
            ),
        }

    return {
        "symbol": symbol,
        "entradas": {
            "base_fcf": base_fcf,
            "net_debt": net_debt,
            # Si mandas tu deuda neta, manda la tuya y no hay nada parcial que avisar.
            "deuda_parcial": datos["deuda_parcial"] if request.net_debt is None else None,
            "nota_deuda": (
                nota_deuda_parcial(datos["deuda_parcial"])
                if request.net_debt is None and datos["deuda_parcial"] else None
            ),
            "shares_outstanding": acciones,
            "revenue": datos["revenue"],
            "eps": datos["eps"],
            "precio_actual": datos["precio"],
            "fiscal_year": datos["fiscal_year"],
            "crecimiento_historico": datos["crecimiento"],
            "years": request.years,
            "source": datos["source"],
        },
        "escenarios": escenarios,
        "rango_global": global_,
        "sensibilidad": sensibilidad,
        "dcf_inverso": inverso,
        "comparables": _comparables(service, symbol, datos["precio"], datos["eps"]),
        "nota_supuestos": (
            "Los supuestos de partida salen del crecimiento histórico REAL de la "
            f"empresa, acotado al {fmt_pct(CRECIMIENTO_MAXIMO, 0)} — extrapolar a "
            "perpetuidad el mejor quinquenio es el error más común del DCF casero. "
            "Cámbialos: son un punto de arranque, no una opinión de la app."
            + (
                " Con el FCF de partida negativo, crecer es quemar más caja: el bajista "
                "lleva los supuestos que más agrandan la quema (más crecimiento, menos "
                "descuento) y el alcista, los que menos."
                if base_fcf < 0 and not request.escenarios
                else ""
            )
        ),
        "disclaimer": (
            "Aquí no hay ningún precio objetivo, y no por estilo: no existe en el "
            "código un campo donde quepa uno. Los escenarios dan rangos, los "
            "comparables dan un intervalo de predicción y el DCF inverso da una "
            "curva. Un DCF no dice cuánto vale una empresa; dice qué implican unos "
            "supuestos, y los supuestos son tuyos."
        ),
        "computed_by": "app",  # aritmética local, sin LLM
    }

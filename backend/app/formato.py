"""Una sola forma de escribir cifras para una persona (ítem 1.7: V4, V5, V8).

Antes cada módulo formateaba a su manera: el backend con f-strings en inglés
(«31.2 %», «EPS estimado 1.12», «0.210») y el frontend en es-ES («45,5 %»), en
la misma pantalla; la regla es-ES no agrupa los números de cuatro cifras y
salía «6000,00» encima de «20.000,00» en la misma columna; y un -0,0001
redondeado se escribía «-0 %». Todo texto con cifras para el usuario pasa por
aquí, y `frontend/src/lib/formato.ts` es su gemelo exacto: los dos se prueban
contra la misma tabla de casos (`frontend/src/lib/formato.casos.json`) y tienen
que dar la misma cadena, carácter a carácter.

Reglas:
- coma decimal y punto de miles, también con cuatro cifras (6.000,00);
- espacio duro antes de «%» y de la moneda: la cifra no se parte al final de
  una línea;
- un cero negativo se escribe 0 («-0,00» no existe);
- `None`, NaN e infinito son «—»: ausente ≠ cero;
- la moneda se escribe con su código (USD, CAD, EUR), nunca con «$», que no
  distingue el dólar de EE. UU. del canadiense;
- redondeo a la mitad hacia arriba sobre la representación decimal más corta
  del número, como ICU en el navegador: con el `format` de Python, 2,675 a dos
  decimales salía 2,67 y en el frontend 2,68.
"""

from __future__ import annotations

import math
import numbers
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

GUION = "—"
ESPACIO_DURO = "\u00a0"

MESES = ("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic")

# Una hora de mercado lleva la zona de su bolsa (§1.7): «16:00 ET» no es lo mismo
# que las 16:00 de quien lo lee.
ETIQUETAS_ZONA = {"America/New_York": "ET", "America/Toronto": "ET", "UTC": "UTC"}


def _cifra(valor) -> float | None:
    """La cifra como float, o None si no la hay. numpy (np.int64, np.float32) y
    Decimal también son cifras: antes daban «—», un número presente pintado como
    ausente (revisión de la Fase 1). Un booleano no lo es."""
    if isinstance(valor, bool) or not isinstance(valor, (numbers.Real, Decimal)):
        return None
    v = float(valor)
    return v if math.isfinite(v) else None


def _redondear(valor: float, decimales: int) -> Decimal:
    return Decimal(repr(float(valor))).quantize(Decimal(1).scaleb(-decimales), rounding=ROUND_HALF_UP)


def _es_es(d: Decimal, decimales: int) -> str:
    """|d| con punto de miles y coma decimal: 6000.00 → «6.000,00»."""
    return format(abs(d), f",.{decimales}f").translate(str.maketrans(",.", ".,"))


def _con_signo(d: Decimal, texto: str, signo: bool) -> str:
    if d == 0:
        return texto  # -0,0001 redondeado es 0, no «-0,00» (V8)
    if d < 0:
        return "-" + texto
    return ("+" if signo else "") + texto


def fmt_num(valor, decimales: int = 2, *, signo: bool = False, ceros: bool = True) -> str:
    """6000 → «6.000,00». `signo`: «+» delante de los positivos (variaciones).
    `ceros=False`: hasta `decimales`, sin ceros a la derecha (1,50 → «1,5»; 2,00
    → «2»), para un umbral o un parámetro que se escribe tal cual es."""
    valor = _cifra(valor)
    if valor is None:
        return GUION
    d = _redondear(valor, decimales)
    texto = _es_es(d, decimales)
    if not ceros and decimales:
        texto = texto.rstrip("0").rstrip(",")
    return _con_signo(d, texto, signo)


def fmt_pct(
    valor, decimales: int = 1, *, signo: bool = False, en_puntos: bool = False, ceros: bool = True
) -> str:
    """0,123 → «12,3 %». Con `en_puntos`, el valor ya viene en puntos (12,3)."""
    valor = _cifra(valor)
    if valor is None:
        return GUION
    v = valor if en_puntos else valor * 100
    return f"{fmt_num(v, decimales, signo=signo, ceros=ceros)}{ESPACIO_DURO}%"


def plural(n, singular: str, plural: str) -> str:
    """La forma que toca: «1 posición», «0 posiciones», «2 posiciones». Antes
    se escribía «posición(es)» y el verbo no concordaba con ninguna de las dos."""
    return singular if n in (1, -1) else plural


def fmt_dinero(valor, moneda: str | None, decimales: int = 2, *, signo: bool = False) -> str:
    """6000 USD → «6.000,00 USD». Sin moneda conocida, solo la cifra."""
    valor = _cifra(valor)
    if valor is None:
        return GUION
    cifra = fmt_num(valor, decimales, signo=signo)
    return f"{cifra}{ESPACIO_DURO}{moneda}" if moneda else cifra


PRECIO_MAX_DECIMALES = 20  # el tope de Intl.NumberFormat en el gemelo


def decimales_precio(valor: float) -> int:
    """Los decimales con que se escribe (y se guarda) un precio por acción.

    Desde 1, dos: el tick de las acciones que cotizan por encima del dólar. Por
    debajo, los que den cuatro cifras significativas: con dos fijos, el stop de
    0,004 de una acción de céntimos era 0,00 y un precio de 0,003 era 0, y el
    stop no se perforaba nunca (auditoría del 19 oct). El exponente sale de la
    representación más corta del número, la misma que `toExponential()` en el
    gemelo: con `log10` los dos lados podían discrepar en la frontera."""
    a = abs(valor)
    if a >= 1 or a == 0:
        return 2
    exponente = Decimal(repr(a)).adjusted()
    return min(PRECIO_MAX_DECIMALES, max(2, 3 - exponente))


def fmt_precio(valor, moneda: str | None = None, *, signo: bool = False) -> str:
    """Un precio por acción o un nivel: 150 → «150,00»; 0,004 → «0,004».

    Al menos dos decimales y, por debajo de 1, hasta cuatro cifras
    significativas sin ceros de más (`decimales_precio`)."""
    valor = _cifra(valor)
    if valor is None:
        return GUION
    decimales = decimales_precio(valor)
    d = _redondear(valor, decimales)
    entera, _, fraccion = _es_es(d, decimales).partition(",")
    cifra = _con_signo(d, f"{entera},{fraccion.rstrip('0').ljust(2, '0')}", signo)
    return f"{cifra}{ESPACIO_DURO}{moneda}" if moneda else cifra


def fmt_valor_redondo(valor, moneda: str | None = None) -> str:
    """Un valor por acción ya redondeado a cifras significativas (el rango del
    DCF): 147 → «147»; 1470 → «1.470»; 0,00347 → «0,00347». Sin los céntimos que
    `fmt_precio` añadiría («147,00» finge una precisión que el método no tiene)
    y sin perder los de una acción de céntimos (con cero decimales, «0»)."""
    valor = _cifra(valor)
    if valor is None:
        return GUION
    cifra = fmt_num(valor, decimales_precio(valor), ceros=False)
    return f"{cifra}{ESPACIO_DURO}{moneda}" if moneda else cifra


def decimales_frente(valor: float, umbrales, pct: bool = False) -> int:
    """Los decimales con que `valor` no cambia de lado frente a sus umbrales: cada
    umbral escrito entero, el valor nunca escrito igual que un umbral distinto ni
    como cero sin serlo. Se compara lo que de verdad se escribe (el redondeo del
    formateador, no `round()`): con `round`, 0,995 «era» 0,99 y se escribía
    «1,00» frente a «< 1» (revisión 6). Con los de siempre (uno en %, dos en
    «veces») basta casi siempre."""
    def escribir(v, d):
        return fmt_pct(v, d, ceros=False) if pct else fmt_num(v, d, ceros=False)

    base = 1 if pct else 2
    for decimales in range(base, base + 7):
        if any(escribir(u, decimales) != escribir(u, 9) for u in umbrales):
            continue
        if any(valor != u and escribir(valor, decimales) == escribir(u, decimales) for u in umbrales):
            continue
        if valor != 0 and escribir(valor, decimales) == escribir(0, decimales):
            continue
        return decimales
    return base + 6


def fmt_frente(valor, umbral, *, pct: bool = False, ceros: bool = True) -> str:
    """Una cifra junto a su umbral, sin cambiar de lado al escribirla: 0,996
    frente a «< 1» → «0,996», no «1,00»; 0,1796 frente a «≥ 18 %» → «17,96 %»
    (revisión 6). Lejos del umbral, como siempre: 0,8 → «0,80»; 0,23 → «23,0 %»."""
    valor, umbral = _cifra(valor), _cifra(umbral)
    if valor is None:
        return GUION
    if umbral is None:
        return fmt_pct(valor, 1) if pct else fmt_num(valor, 2)
    decimales = decimales_frente(valor, [umbral], pct)
    con_ceros = ceros and decimales == (1 if pct else 2)
    return fmt_pct(valor, decimales, ceros=con_ceros) if pct else fmt_num(valor, decimales, ceros=con_ceros)


def fmt_cifras(valor, cifras: int = 3) -> str:
    """Un valor calculado con supuestos, con `cifras` cifras significativas y sin
    decimales desde las centenas: 170,63 → «171»; 17,063 → «17,1»; 0,05328 →
    «0,0533»; 1706,3 → «1.706». Para la matriz de sensibilidad del DCF, que
    llega sin redondear: con dos decimales «170,63» fingía una precisión que el
    método no tiene, y con cero una acción de 0,40 era «0» en todas las celdas
    (revisión 5)."""
    valor = _cifra(valor)
    if valor is None:
        return GUION
    if valor == 0:
        return fmt_num(0, 0)
    exponente = Decimal(repr(abs(valor))).adjusted()
    return fmt_num(valor, max(0, cifras - 1 - exponente), ceros=False)


def _corto(valor: float, max_decimales: int) -> str:
    """Hasta `max_decimales`, sin ceros a la derecha: 400,0 → «400»; 1,25 → «1,25»."""
    return fmt_num(valor, max_decimales, ceros=False)


def fmt_compacto(valor, moneda: str | None = None) -> str:
    """Cifras grandes en M (millones) y mil M (miles de millones).

    Nunca «B»: en inglés es mil millones y en español un billón; el ETF de
    400 000 millones salía «400.0 B$». Por encima del billón se sigue en mil M
    («3.400 mil M»), que no se puede leer mal."""
    valor = _cifra(valor)
    if valor is None:
        return GUION
    a = abs(valor)
    if a >= 1e9:
        cifra = f"{_corto(valor / 1e9, 1)}{ESPACIO_DURO}mil{ESPACIO_DURO}M"
    elif a >= 1e6:
        cifra = f"{_corto(valor / 1e6, 1)}{ESPACIO_DURO}M"
    else:
        cifra = _corto(valor, 2)
    return f"{cifra}{ESPACIO_DURO}{moneda}" if moneda else cifra


def _a_fecha(valor) -> date | datetime | None:
    """Una fecha (día) o un instante con zona. Un instante sin zona es UTC: es la
    convención del backend, y SQLite la pierde al guardar."""
    if isinstance(valor, datetime):
        instante = valor
    elif isinstance(valor, date):
        return valor
    elif isinstance(valor, str) and valor:
        texto = valor.strip()
        if len(texto) == 10:
            try:
                return date.fromisoformat(texto)
            except ValueError:
                return None
        try:
            instante = datetime.fromisoformat(texto.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    return instante if instante.tzinfo else instante.replace(tzinfo=timezone.utc)


def fmt_fecha(valor, *, hora: bool = False, zona: str | None = None) -> str:
    """«6 oct 2026» o, con `hora`, «12 sept 2026, 10:35 ET».

    Un día suelto («2026-10-06») no se mueve de zona: es un día del calendario.
    Un instante se pasa a `zona` (UTC si no se da) y, si es la de una bolsa, se
    rotula. Lo que no se puede leer como fecha se devuelve tal cual."""
    if valor is None or valor == "":
        return GUION
    f = _a_fecha(valor)
    if f is None:
        return str(valor)
    if isinstance(f, datetime):
        nombre = zona or "UTC"
        f = f.astimezone(ZoneInfo(nombre))
        dia = f"{f.day} {MESES[f.month - 1]} {f.year}"
        if not hora:
            return dia
        etiqueta = ETIQUETAS_ZONA.get(nombre)
        return f"{dia}, {f.hour:02d}:{f.minute:02d}" + (f"{ESPACIO_DURO}{etiqueta}" if etiqueta else "")
    return f"{f.day} {MESES[f.month - 1]} {f.year}"


def fmt_antiguedad(valor, ahora: datetime) -> str:
    """«hace 15 min». `ahora` es obligatorio: el pasado se reconstruye con su
    propio reloj (punto en el tiempo), no con el de la máquina."""
    f = _a_fecha(valor)
    if not isinstance(f, datetime):
        return GUION
    segundos = (ahora - f).total_seconds()
    minutos = math.floor(segundos / 60 + 0.5)
    # Unos minutos de desfase de reloj entre el servidor y el dato no son «el futuro»;
    # más sí: «hace segundos» hacía pasar por fresco un dato con la zona mal leída
    # (cuatro horas «en el futuro»; revisión de la Fase 1).
    if minutos <= -5:
        return "con fecha futura"
    if minutos < 1:
        return "hace segundos"
    if minutos < 60:
        return f"hace {minutos} min"
    horas = math.floor(minutos / 60 + 0.5)
    if horas < 48:
        return f"hace {horas} h"
    return f"hace {math.floor(horas / 24 + 0.5)} días"

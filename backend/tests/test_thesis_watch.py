"""Vigilancia de tesis: comprobar los umbrales que TÚ escribiste.

Lo que se fija aquí:

- que un umbral cruzado se detecte, y uno no cruzado no se invente;
- que «no se pudo medir» NUNCA se cuente como «está bien»;
- que el disparador de noticias se declare como lo que es —buscar palabras— y
  no como vigilancia;
- y que un disparador que salta se presente como un recordatorio para releer la
  tesis, no como una señal de venta.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.analysis.thesis_watch import (
    coherencia,
    evaluar,
    evaluar_noticia,
    instantanea,
    vigilar,
)


def disp(kind, config, descripcion="porque sí", **kw):
    return {"id": 1, "kind": kind, "descripcion": descripcion, "config": config,
            "activo": True, **kw}


RATIOS = [
    {"fiscal_year": 2022, "operating_margin": 0.25, "roe": 0.30},
    {"fiscal_year": 2023, "operating_margin": 0.22, "roe": 0.28},
    {"fiscal_year": 2024, "operating_margin": 0.19, "roe": 0.26},
    {"fiscal_year": 2025, "operating_margin": 0.16, "roe": 0.24},
]


# --- Disparadores de métrica --------------------------------------------------


def test_un_umbral_cruzado_salta_con_el_valor_y_el_umbral():
    r = evaluar(
        disp("metrica", {"metrica": "operating_margin", "op": "lt", "umbral": 0.18}),
        {"ratios": RATIOS},
    )
    assert r["salta"] is True
    assert r["valor"] == 0.16
    assert r["umbral"] == 0.18
    # En su unidad: un margen en % (antes «0,160»; revisión del 2.12).
    assert "16,0\u00a0%" in r["detalle"]
    assert r["ejercicio"] == 2025


def test_un_umbral_no_cruzado_no_se_inventa():
    r = evaluar(
        disp("metrica", {"metrica": "operating_margin", "op": "lt", "umbral": 0.10}),
        {"ratios": RATIOS},
    )
    assert r["salta"] is False
    assert "Todavía no lo cruza" in r["detalle"]


def test_la_tendencia_acompaña_al_veredicto():
    """Cruzar el umbral tras tres años de caídas no es lo mismo que cruzarlo tras
    un año malo aislado."""
    r = evaluar(
        disp("metrica", {"metrica": "operating_margin", "op": "lt", "umbral": 0.18}),
        {"ratios": RATIOS},
    )
    assert r["tendencia"] == "bajando"
    assert r["serie"] == [0.25, 0.22, 0.19, 0.16]


def test_un_dato_que_falta_no_cuenta_como_que_esta_bien():
    """La distinción que más importa: «no se pudo medir» y «no salta» son cosas
    distintas, y confundirlas convierte un fallo de datos en tranquilidad."""
    r = evaluar(
        disp("metrica", {"metrica": "roic", "op": "lt", "umbral": 0.10}),
        {"ratios": RATIOS},
    )
    assert r["salta"] is False
    assert r["medible"] is False
    assert "no es lo mismo que estar por encima del umbral" in r["motivo"]


def test_sin_estados_financieros_no_se_comprueba_nada():
    r = evaluar(
        disp("metrica", {"metrica": "operating_margin", "op": "lt", "umbral": 0.18}),
        {"ratios": []},
    )
    assert r["medible"] is False


def test_un_disparador_mal_configurado_se_declara_en_vez_de_pasar():
    r = evaluar(disp("metrica", {"metrica": "roe", "op": "raro", "umbral": 0.1}), {"ratios": RATIOS})
    assert r["medible"] is False
    assert "mal configurado" in r["motivo"]


# --- Crecimiento --------------------------------------------------------------


def test_la_desaceleracion_del_crecimiento_salta():
    r = evaluar(
        disp("crecimiento", {"metrica": "revenue_cagr", "op": "lt", "umbral": 0.05}),
        {"crecimiento": {"revenue_cagr": 0.03}},
    )
    assert r["salta"] is True
    assert r["valor"] == 0.03


# --- Noticias: buscar palabras, no entender ----------------------------------


def _noticia(headline, dias=1, summary=""):
    return {
        "headline": headline,
        "summary": summary,
        "url": "https://x/1",
        "source": "fake",
        "published_at": (datetime.now(timezone.utc) - timedelta(days=dias)).isoformat(),
    }


def test_una_palabra_clave_en_un_titular_salta_con_su_enlace():
    r = evaluar_noticia(
        {"palabras": ["recall", "investigación"]},
        [_noticia("Regulators open investigación into the company")],
    )
    assert r["salta"] is True
    assert r["coincidencias"][0]["palabras"] == ["investigación"]
    assert r["coincidencias"][0]["url"]


def test_las_tildes_no_impiden_la_coincidencia():
    """«investigacion» en un titular tiene que casar con «investigación»."""
    r = evaluar_noticia({"palabras": ["investigación"]}, [_noticia("Nueva investigacion abierta")])
    assert r["salta"] is True


def test_una_palabra_dentro_de_otra_no_cuenta():
    """Buscar «cae» dentro de «cadena» convertiría el vigilante en ruido."""
    r = evaluar_noticia({"palabras": ["cae"]}, [_noticia("Problemas en la cadena de suministro")])
    assert r["salta"] is False


def test_las_noticias_viejas_quedan_fuera_de_la_ventana():
    r = evaluar_noticia({"palabras": ["recall"]}, [_noticia("Big recall announced", dias=60)])
    assert r["salta"] is False
    assert r["titulares_revisados"] == 0


def test_el_disparador_de_noticias_declara_que_solo_busca_palabras():
    """La diferencia con los otros dos tipos es grande y no se ve: un margen que
    cruza es un hecho de los estados; esto es una coincidencia de texto."""
    r = evaluar_noticia({"palabras": ["recall"]}, [_noticia("A recall today")])
    assert "BUSCA PALABRAS, no entiende" in r["aviso"]
    assert "falsos positivos" in r["aviso"]
    assert "revisión voluntaria" in r["aviso"]


def test_un_disparador_de_noticias_sin_palabras_no_es_medible():
    r = evaluar_noticia({"palabras": []}, [_noticia("algo")])
    assert r["medible"] is False


def test_sin_noticias_por_un_fallo_el_disparador_queda_sin_comprobar():
    """Si la descarga falla no se revisó ningún titular: eso no es «ninguno
    contiene esas palabras». Antes salía medible con 0 titulares y la tesis se
    daba por intacta justo cuando no se había podido mirar."""
    r = evaluar_noticia({"palabras": ["recall"]}, None)
    assert r["medible"] is False and r["salta"] is False
    assert "no se pudieron descargar" in r["motivo"]


def test_una_descarga_buena_sin_titulares_si_es_una_comprobacion():
    """Una lista vacía que llegó bien es un dato: no hubo titulares en la ventana."""
    r = evaluar_noticia({"palabras": ["recall"]}, [])
    assert r["medible"] is True and r["salta"] is False


def test_sin_la_clave_de_noticias_la_vigilancia_no_las_da_por_buenas():
    """Quien llame a `vigilar` sin traer las noticias no puede obtener un PASS."""
    r = vigilar([disp("noticia", {"palabras": ["recall"]})], {"ratios": RATIOS})
    assert r["sin_medir"] == 1 and r["saltan"] == 0
    assert "no se pudo comprobar" in r["nota"]


# --- El conjunto --------------------------------------------------------------


def test_lo_no_medible_se_cuenta_aparte_de_lo_que_no_salta():
    r = vigilar(
        [
            disp("metrica", {"metrica": "operating_margin", "op": "lt", "umbral": 0.18}),
            disp("metrica", {"metrica": "roic", "op": "lt", "umbral": 0.10}),
            disp("metrica", {"metrica": "roe", "op": "lt", "umbral": 0.05}),
        ],
        {"ratios": RATIOS},
    )
    assert r["saltan"] == 1     # el margen
    assert r["sin_medir"] == 1  # el ROIC, que no está en la serie
    assert r["total"] == 3
    assert "no es lo mismo que estar bien" in r["nota"]


def test_un_disparador_que_salta_no_se_presenta_como_señal_de_venta():
    """Lo escribiste tú cuando pensabas con más calma. Lo que toca es releer."""
    r = vigilar(
        [disp("metrica", {"metrica": "operating_margin", "op": "lt", "umbral": 0.18})],
        {"ratios": RATIOS},
    )
    assert "no es una señal de venta" in r["nota"]
    assert "releer la tesis" in r["nota"]


def test_una_tesis_sin_disparadores_se_señala_como_no_vigilada():
    r = vigilar([], {})
    assert r["total"] == 0
    assert "nadie lo mira solo" in r["nota"]


def test_los_disparadores_inactivos_no_se_evaluan():
    r = vigilar(
        [disp("metrica", {"metrica": "operating_margin", "op": "lt", "umbral": 0.18},
              activo=False)],
        {"ratios": RATIOS},
    )
    assert r["total"] == 0


# --- La instantánea y la coherencia ------------------------------------------


def test_la_instantanea_congela_lo_que_la_app_enseñaba():
    """Reconstruir seis meses después qué sabías es imposible: la memoria
    reescribe el pasado para que encaje con lo que pasó."""
    v = vigilar(
        [disp("metrica", {"metrica": "operating_margin", "op": "lt", "umbral": 0.18},
              descripcion="Si el margen baja del 18 %")],
        {"ratios": RATIOS},
    )
    snap = instantanea(140.0, v, {"id": 3, "title": "Tesis", "created_at": "2026-01-01"})
    assert snap["precio"] == 140.0
    assert snap["tesis"]["id"] == 3
    assert len(snap["disparadores_saltando"]) == 1
    assert "Si el margen baja del 18 %" in snap["disparadores_saltando"][0]["descripcion"]
    assert snap["capturado_en"]


def test_la_instantanea_congela_tambien_lo_que_no_se_pudo_comprobar():
    """Sin esto, una decisión tomada con las noticias caídas quedaba en el
    registro como «0 puntos saltando», sin rastro de que no se había mirado."""
    v = vigilar([disp("noticia", {"palabras": ["recall"]}, descripcion="Si hay un recall")],
                {"noticias": None})
    snap = instantanea(140.0, v, None)
    assert snap["disparadores_saltando"] == []
    assert snap["disparadores_sin_comprobar"][0]["descripcion"] == "Si hay un recall"
    assert "no se pudieron descargar" in snap["disparadores_sin_comprobar"][0]["motivo"]


def test_la_coherencia_señala_las_decisiones_sin_tesis():
    """Incómodo a propósito: una decisión sin tesis no se puede revisar después."""
    r = coherencia([
        {"accion": "comprar", "thesis_id": None, "contexto": {}},
        {"accion": "comprar", "thesis_id": 1, "contexto": {}},
    ])
    assert r["sin_tesis"] == 1
    assert "no se puede revisar después" in r["nota"]


def test_la_coherencia_señala_comprar_con_puntos_de_invalidacion_saltando():
    r = coherencia([
        {
            "accion": "reforzar", "thesis_id": 1,
            "contexto": {"disparadores_saltando": [{"descripcion": "margen"}]},
        }
    ])
    assert r["con_disparadores_activos"] == 1
    assert "ya saltando" in r["nota"]
    # No lo llama error: lo escribiste tú y puedes haber cambiado de opinión.
    assert "puede estar perfectamente justificado" in r["nota"].lower()


def test_sin_decisiones_no_se_inventa_un_diagnostico():
    assert coherencia([])["decisiones"] == 0


def test_noticias_incompletas_no_prueban_que_ningun_titular_lo_diga():
    """Una copia vieja de la caché no cubre la ventana: «ninguno de los N
    titulares» no se puede afirmar. Una coincidencia, en cambio, salta igual:
    ante la duda, avisar (revisión de M1)."""
    nada = evaluar_noticia({"palabras": ["recall"]}, [_noticia("Resultados en línea")], incompletas="copia guardada hace 3 h")
    assert nada["medible"] is False and "copia guardada hace 3 h" in nada["motivo"]
    hay = evaluar_noticia({"palabras": ["recall"]}, [_noticia("Big recall announced")], incompletas="copia guardada hace 3 h")
    assert hay["medible"] is True and hay["salta"] is True


# --- Revisión del 2.12: cada métrica en su unidad --------------------------
#
# El formulario pedía todo en % y dividía entre 100: «ratio corriente < 1» se
# guardaba como 0,01 y el punto no saltaba nunca. Ahora el catálogo dice la
# unidad y los puntos nuevos la guardan (`config.unidad`); uno viejo en «veces»
# se lee de las dos formas, tal cual y ×100 (revisión 3).


def _ratio(metrica, op, umbral, valor, unidad=None):
    config = {"metrica": metrica, "op": op, "umbral": umbral} | ({"unidad": unidad} if unidad else {})
    return evaluar({"id": 1, "kind": "metrica", "descripcion": "x", "activo": True, "config": config},
                   {"ratios": [{"fiscal_year": 2025, metrica: valor}]})


def test_un_ratio_se_lee_en_veces_y_no_en_porcentaje():
    r = _ratio("current_ratio", "lt", 1.0, 0.8, "veces")
    assert r["salta"] is True
    assert r["detalle"].startswith("Ratio corriente = 0,80; el punto salta si ") and "%" not in r["detalle"]
    assert "aviso" not in r


def test_un_punto_viejo_cuyas_dos_lecturas_discrepan_queda_sin_comprobar():
    # 1 escrito en el formulario viejo se guardó como 0,01: con 0,01 no saltaría
    # y con 1, sí. No es «no cruzado»: es «no se puede comprobar» (UNKNOWN nunca PASS).
    r = _ratio("current_ratio", "lt", 0.01, 0.8)
    assert r["salta"] is False and r["medible"] is False
    assert "con 0,01 no saltaría y con 1, sí" in r["motivo"]
    # «Deuda/capital > 2» guardado como 0,02, con D/E 0,5: antes salía CRUZADO.
    assert _ratio("debt_to_equity", "gt", 0.02, 0.5)["medible"] is False
    # Revisión 3: uno viejo de 0,15 («< 15») con cobertura 8 salía «no cruzado».
    assert _ratio("interest_coverage", "lt", 0.15, 8.0)["medible"] is False


def test_un_punto_viejo_cruzado_con_las_dos_lecturas_esta_cruzado():
    # Revisión 3: «cobertura < 10» guardado como 0,1, con EBIT negativo (−1,5),
    # lo cruza leído de las dos formas; el corte por valor lo dejaba sin medir.
    r = _ratio("interest_coverage", "lt", 0.1, -1.5)
    assert r["medible"] is True and r["salta"] is True
    assert _ratio("debt_to_equity", "gt", 0.02, 3.0)["salta"] is True


def test_un_umbral_pequeno_de_un_punto_nuevo_se_lee_tal_cual():
    # Revisión 3: «Deuda/capital > 0,1» creado con el formulario nuevo quedaba
    # sin comprobar para siempre, y rehacerlo volvía a guardar 0,1.
    r = _ratio("debt_to_equity", "gt", 0.1, 0.6, "veces")
    assert r["medible"] is True and r["salta"] is True


def test_cero_o_negativo_es_un_umbral_legitimo():
    # «Cobertura de intereses < 0» (EBIT negativo): sus dos lecturas coinciden.
    r = _ratio("interest_coverage", "lt", 0.0, -1.5)
    assert r["medible"] is True and r["salta"] is True


def test_un_margen_bajo_en_porcentaje_no_es_sospechoso():
    assert _ratio("operating_margin", "lt", 0.05, 0.21)["medible"] is True


# --- Revisión 4: la doble lectura, acotada por métrica y con todas las cifras ---


def test_un_umbral_que_x100_no_cabe_en_la_metrica_se_lee_tal_cual():
    # «Deuda/capital > 0,5» sin unidad (creado entre el arreglo del formulario y
    # el que guarda la unidad, o por la API) se leía también como 50 veces de
    # apalancamiento y, con D/E 0,6, un punto CRUZADO quedaba sin comprobar.
    r = _ratio("debt_to_equity", "gt", 0.5, 0.6)
    assert r["medible"] is True and r["salta"] is True and "aviso" not in r
    assert _ratio("current_ratio", "lt", 0.8, 0.7)["salta"] is True
    # Valores que separan las dos lecturas, para que el tope de cada métrica
    # quede fijado (revisión 5: con 0,7 las dos coincidían y cualquier tope
    # pasaba). Con un tope de 100, los dos quedarían sin comprobar.
    for metrica, umbral in (("current_ratio", 0.8), ("interest_coverage", 0.5)):
        r = _ratio(metrica, "lt", umbral, 1.5 if metrica == "current_ratio" else 8.0)
        assert r["medible"] is True and r["salta"] is False, metrica
    # Un 0,02 sí sigue siendo dudoso (0,02 o 2), y una cobertura de 0,15 (15).
    assert _ratio("debt_to_equity", "gt", 0.02, 0.5)["medible"] is False
    assert _ratio("interest_coverage", "lt", 0.15, 8.0)["medible"] is False


def test_la_lectura_x100_no_se_equivoca_en_coma_flotante():
    # 0,07 × 100 = 7,000000000000001: «cobertura < 7» con cobertura 7 exacta
    # «discrepaba» y el motivo decía «con 7,00, sí» cuando 7 < 7 es falso.
    r = _ratio("interest_coverage", "lt", 0.07, 7.0)
    assert r["medible"] is True and r["salta"] is False
    # Y 0,1 × 100 = 10,000000000000002 no se sale del tope de 10.
    assert _ratio("debt_to_equity", "gt", 0.1, 0.5)["medible"] is False


def test_un_punto_sin_unidad_con_las_dos_lecturas_iguales_lo_avisa_con_su_umbral_entero():
    # «D/E > 0,25» escrito en el formulario viejo se guardó como 0,0025: con D/E
    # 0,6 salta con las dos lecturas, pero el detalle decía «salta si sube por
    # encima de 0,00» y nada avisaba de la duda.
    r = _ratio("debt_to_equity", "gt", 0.0025, 0.6)
    assert r["medible"] is True and r["salta"] is True
    assert "por encima de 0,0025" in r["detalle"]
    assert "0,0025" in r["aviso"] and "puede ser 0,25 escrito por ti" in r["aviso"]
    assert "Con las dos lecturas salta" in r["aviso"]


def test_el_motivo_de_un_punto_dudoso_no_redondea_las_cifras():
    # «D/E > 0,5» viejo, guardado 0,005, con D/E 0,008: el motivo decía «el
    # umbral guardado, 0,01 … Deuda / capital = 0,01: con 0,01 saltaría».
    r = _ratio("debt_to_equity", "gt", 0.005, 0.008)
    assert r["medible"] is False
    assert "el umbral guardado, 0,005, puede ser 0,5 escrito por ti" in r["motivo"]
    assert "Deuda / capital = 0,008: con 0,005 saltaría y con 0,5, no" in r["motivo"]
    assert "anterior al arreglo" not in r["motivo"]


def test_la_nota_no_da_por_no_cruzado_lo_que_no_se_pudo_comprobar():
    from app.analysis.thesis_watch import _resumen

    uno = _resumen(0, 1, 1)
    assert "no se ha cruzado" not in uno and uno.startswith("El único punto de invalidación no se pudo comprobar")
    assert _resumen(0, 3, 3).startswith("Los 3 puntos de invalidación no se pudieron comprobar")
    dos = _resumen(0, 2, 3)
    assert dos.startswith("El único punto comprobado no se ha cruzado. 2 no se pudieron comprobar")
    assert _resumen(0, 1, 3).startswith("Ninguno de los 2 puntos comprobados se ha cruzado. 1 no se pudo")


def test_ninguna_cifra_cambia_de_lado_al_escribirla():
    # Revisión 5: con dos decimales, una cobertura de 2,997 frente a «< 3»
    # (guardado 0,03) decía «= 3: con 0,03 no saltaría y con 3, sí», y un ratio
    # corriente de 0,996 «= 1,00; salta si cae por debajo de 1,00».
    r = _ratio("interest_coverage", "lt", 0.03, 2.997)
    assert r["medible"] is False and "Cobertura de intereses = 2,997: con 0,03 no saltaría y con 3, sí" in r["motivo"]
    r = _ratio("current_ratio", "lt", 1.0, 0.996, "veces")
    assert r["salta"] is True and r["detalle"].startswith("Ratio corriente = 0,996; el punto salta si cae por debajo de 1.")
    r = _ratio("debt_to_equity", "gt", 1.005, 1.008, "veces")
    assert "Deuda / capital = 1,008; el punto salta si sube por encima de 1,005." in r["detalle"]
    # Lejos del umbral, como siempre: dos decimales con ceros.
    assert _ratio("current_ratio", "lt", 1.0, 0.8, "veces")["detalle"].startswith("Ratio corriente = 0,80; ")


def test_el_aviso_de_un_punto_sin_unidad_llega_a_la_ficha_y_a_que_cambio():
    # Revisión 5: `seccion_tesis` copiaba solo algunos campos y el aviso se
    # quedaba en Vigilancia; «Qué cambió» y lo congelado decían solo la centésima.
    from app.analysis import cambios
    from app.analysis.thesis_watch import instantanea

    d = _ratio("debt_to_equity", "gt", 0.001, 0.3)
    assert d["salta"] is True and "puede ser 0,1 escrito por ti" in d["aviso"]
    ahora = {"id": 1, "disparadores": [{"id": 1, "descripcion": "D/E alto", "config": {"metrica": "debt_to_equity"}, **d}]}
    antes = {"id": 1, "disparadores": [{"id": 1, "descripcion": "D/E alto", "salta": False, "medible": True,
                                         "valor": 0.0005, "umbral": 0.001}]}
    inval = cambios.comparar_tesis(antes, ahora)["invalidaciones"][0]["detalle"]
    assert "puede ser 0,1 escrito por ti" in inval
    congelado = instantanea(10.0, {"disparadores": ahora["disparadores"], "total": 1}, None)
    assert "puede ser 0,1 escrito por ti" in congelado["disparadores_saltando"][0]["aviso"]


def test_que_cambio_escribe_un_margen_en_porcentaje():
    # Revisión 5: «se acerca a su umbral (0,213 → 0,190, umbral 0,180)» junto a «< 18 %».
    from app.analysis import cambios

    def tesis(v):
        return {"id": 1, "disparadores": [{"id": 1, "descripcion": "margen < 18 %", "salta": False, "medible": True,
                                            "valor": v, "umbral": 0.18,
                                            "config": {"metrica": "operating_margin", "op": "lt", "umbral": 0.18}}]}
    det = cambios.comparar_tesis(tesis(0.213), tesis(0.19))["deteriorados"][0]["detalle"]
    assert det == "se acerca a su umbral (21,3\u00a0% → 19,0\u00a0%, umbral 18,0\u00a0%)"


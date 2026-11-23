# Expectativas frente a resultados

Registrar qué se esperaba **antes** de un evento y compararlo **después** con lo que
salió. Resultados trimestrales primero; la forma sirve para investor days,
actualizaciones de guidance, decisiones regulatorias, lanzamientos u otros.

## Tablas (migración 0007)

| Tabla | Qué guarda | Garantías |
|---|---|---|
| `catalyst_events` | símbolo, tipo, periodo («2026-Q3»), cierre del periodo, fecha prevista | `UNIQUE(symbol, tipo, periodo)`, `CHECK` del tipo |
| `expectations` | métrica, `fuente_tipo`, fuente, valor / rango / operador, unidad, `informacion_hasta`, `registrado_en`, detalle | **inmutable** (ORM + triggers), `UNIQUE(event_id, metrica, fuente_tipo, fuente)`, `CHECK` de fuente y de cifra, FK al evento |
| `event_actuals` | métrica, valor, fuente (documento), `publicado`, linaje | solo se añaden filas (una reexpresión es otra fila), FK al evento |

Las lecturas, clasificaciones y calibraciones **no** se guardan: son funciones
deterministas de esas tres tablas y se recalculan con la versión vigente de las
reglas.

## Fuentes, nunca mezcladas

| `fuente_tipo` | De dónde sale | Marca |
|---|---|---|
| `consenso` | `eps_estimate` y `revenue_estimate` del calendario de Finnhub | — |
| `guidance` | previsiones extraídas de un 8-K/10-Q ya analizado, **solo con la cita verificada** | `generado_por: ia` (la cifra la extrajo una IA; métrica, periodo y unidades los asigna el código) |
| `modelo_interno` | mismo trimestre del año anterior × (1 + mediana del crecimiento interanual de 4 trimestres); márgenes = media de 4 trimestres | fuente «app: modelo interno v2» (antes de la revisión 13, «v1»); método, insumos y cierre del trimestre estimado (`trimestre_objetivo_fin`) en `detalle` |
| `reglas` | los puntos de invalidación métricos de la tesis, invertidos (la tesis exige margen ≥ 18 %) | `trigger_id`, `tesis_id`, valor previo |
| `usuario` | KPIs sectoriales u otras variables anotadas a mano | `generado_por: usuario` |

Cada fuente tiene su columna en la lectura y su propia calibración.

**El trimestre que estima el modelo interno** es el del evento (`_fin_objetivo`): el
cierre del periodo si el evento lo trae; si el trimestre ya está publicado, su cierre;
si no, el del último trimestre conocido más tantos trimestres fiscales como separen su
periodo del del evento («2025-Q4» → «2026-Q2»: dos). Sin un periodo «AAAA-Qn», el
último cierre trimestral anterior a la fecha prevista. Sin periodo ni fecha no se sabe
qué trimestre es: no se estima y `sin_fuente` lo dice. Con fecha prevista pero sin que
cierre otro trimestre antes de ella (el evento publicaría uno ya conocido), tampoco se
estima, y `sin_fuente` da ese motivo con las dos fechas; antes decía «sin periodo
legible ni fecha prevista» con la fecha puesta (revisión 13). Antes era siempre «el
siguiente al último conocido»: con el 2026-Q1 sin publicar, el modelo estimó el
trimestre que cierra el 31 de marzo para el evento del 2026-Q2 (revisión 12, visual).

**El método corregido es otra fuente.** Las filas «app: modelo interno v1» capturadas
antes del arreglo pueden ser de otro trimestre, y son inmutables. Con la restricción
única (evento, métrica, tipo, fuente), una fila v1 del trimestre equivocado impedía
guardar la corregida al recapturar: la respuesta daba el trimestre nuevo y solo
`ya_existian: 1`, sin avisar (revisión 13). Desde entonces el modelo registra como
«app: modelo interno v2», una fila nueva y legal (nada se actualiza), y `capturar`,
por cada métrica:

- si ya hay una estimación del modelo interno del mismo trimestre (v1 o v2, a menos
  de medio trimestre), no registra otra y la cuenta en `ya_existian`: la v1 con el
  trimestre bien elegido calculaba lo mismo, y dos filas harían contar dos veces el
  evento en la calibración;
- si la que hay es de otro trimestre, registra la v2 y lo dice en `sin_fuente` con
  las dos fechas; la v1 se conserva y la lectura y la calibración la dejan fuera
  (`periodo_distinto`, más abajo);
- si la que hay no dice qué trimestre estimó, no registra otra y lo dice.

La calibración agrupa por `fuente_tipo`, no por el nombre de la fuente: v1 y v2
siguen siendo «modelo interno». El golden master no tiene expectativas; las
respuestas grabadas para el frontend (`frontend/src/test/fixtures`) sí llevan el
nombre de la fuente y se regeneran.

**Escala.** El consenso y el guidance, que vienen de fuera, se comparan antes de
registrarse con el último trimestre publicado de la misma métrica
(`comprobar_escala`): ingresos entre 0,2× y 5×, BPA entre 0,02× y 50×. Fuera de
la banda, «escala dudosa»: no se registra y se dice por qué (un consenso en miles
se leería como una sorpresa del −99,9 % y estropearía la calibración). Sin
trimestre comparable, o con pérdidas en un lado, `sin_referencia`: se registra
sin juzgar. El resultado de la comprobación viaja en `detalle.escala`.

## Sin información futura

La validez se mide sobre `registrado_en` —la única prueba que tiene el sistema de
cuándo conoció la expectativa— con la regla común (`punto_en_el_tiempo`). El corte
del evento es la fecha prevista o la primera publicación de un resultado real, lo
que llegue antes:

- registrada después del corte → no cuenta, ni en la lectura ni en la calibración;
- registrada **el mismo día** → no cuenta: los resultados salen antes de abrir o
  después de cerrar, y una fecha no dice cuál;
- capturar con el evento ya conocido se **niega** (409);
- `informacion_hasta` nunca es posterior a `registrado_en`. El calendario de
  Finnhub se descarga durante la propia captura y llega fechado segundos después
  de `ahora`: con el margen de lo descargado durante el cálculo
  (`descargado_a_tiempo`, 5 minutos) se acepta y se guarda como conocido en
  `ahora`; más allá, la captura responde 422 y no registra nada. El margen es
  solo para lo descargado: una expectativa anotada a mano con la información
  fechada después de su registro, o con una fecha ilegible, es un 422;
- un consenso que ya trae el resultado real en el calendario no se registra;
- el resumen que entra en un análisis a una fecha (`resumen_para_analisis`) solo lee
  las expectativas, los resultados y los puntos de la tesis registrados entonces
  (`evaluar(..., ahora)`); un punto de la tesis añadido después tampoco fija una
  expectativa de «reglas» antes de existir.

## Resultados reales

`POST /api/expectativas/eventos/{id}/resultados` lee el trimestre de EDGAR:
ingresos, BPA, márgenes bruto y operativo, beneficio y FCF, con etiqueta XBRL,
formulario, número de acceso y fecha. Los trimestres conservan la cifra publicada
**primero** (no la reexpresada); el segundo y tercer trimestre de flujo de caja,
que los 10-Q dan solo acumulados, se derivan como acumulado − acumulado anterior;
el cuarto como año − nueve meses. El BPA del cuarto trimestre no se deriva.

La dirección del guidance (sube / baja / se mantiene / mixta) sale de la
comparación entre trimestres ya hecha: cifras extraídas por IA con cita, variación
calculada por código.

## La lectura

Métrica a métrica: **supera**, **en línea** (tolerancia: 1 % en ingresos, 2 % en
BPA, medio punto en márgenes), **por debajo**, o **desconocido** si no hay real.
Un BPA esperado negativo no produce porcentajes: se da la diferencia.

En conjunto vota **una fuente por métrica** (consenso > guidance > usuario > modelo
interno). Votos en las dos direcciones = **MIXTO**, sin compensar: batir en
ingresos con el margen por debajo y el guidance a la baja no es un buen
trimestre. Sin votos = desconocido; con métricas sin real (`sin_resultado`) o sin
una expectativa del mismo trimestre (`no_comparables`), `parcial`.

**Otro trimestre.** Si la expectativa dice qué trimestre estimó
(`detalle.trimestre_objetivo_fin`) y su cierre está a más de medio trimestre (45 días)
del cierre del real (`detalle.periodo_fin`), no miden lo mismo: la fila se enseña con
sus cifras, pero sin sorpresa ni lectura (`desconocido`, con `periodo_distinto` y el
motivo), no vota y no entra en la calibración. Las expectativas son inmutables y las
capturadas antes de la revisión 12 pueden haber estimado el trimestre equivocado: no
se corrigen, se marcan al leerlas. Unos días de diferencia (un año de 52 o 53
semanas) son el mismo trimestre.

Impacto en la tesis: cada punto métrico queda **confirmado**, **debilitado** (se
cumple, pero un punto más cerca del umbral que el último trimestre conocido),
**invalidado** o **sin resolver** (noticias, crecimientos plurianuales). Cada
elemento de `impacto_en_tesis` lleva `tesis_id` (la tesis del punto) y
`disparador_id` (el id del punto, el mismo que `tesis.disparadores[].id` del
análisis de empresa). Las reglas se capturan de **todas** las tesis del símbolo, y
el mismo punto lo cruzan la vigilancia (con el ejercicio anual) y el trimestre:
«Qué cambió» lo contaba dos veces y enseñaba puntos de tesis que no estaba
enseñando (revisión 13). Con los dos ids la pantalla agrupa por punto y filtra por
la tesis que enseña. Las listas de `cambios.tesis` (confirmados, deteriorados,
invalidaciones, nuevos riesgos) llevan los mismos dos campos, también las que
vienen de los resultados (`origen: "resultados"`). En una regla guardada sin
`tesis_id` sale de su punto; en lecturas congeladas antes, faltan.

## Calibración

`GET /api/expectativas/calibracion?symbol=` — por fuente: n, error medio absoluto
(relativo en importes y BPA, en puntos en los márgenes), **sesgo con signo**
(positivo = lo real salió por encima: se esperaba de menos), % dentro de tolerancia
(«Cerca» en la pantalla: la misma tolerancia que «en línea», con un rango medido desde
su centro), métrica mejor prevista y empresas menos previsibles. Con menos de 5 pares,
el número describe la muestra, no a la fuente. `definiciones` explica «Error medio» y
«Cerca» con las tolerancias de las métricas que hay (la pantalla las enseñaba sin
decir qué medían), y `excluidos_otro_trimestre` cuenta los pares que quedan fuera
porque la expectativa estimó otro trimestre.

## API

```
POST /api/expectativas/eventos                     crear evento
POST /api/expectativas/{symbol}/proximos-resultados  evento desde el calendario + captura
POST /api/expectativas/eventos/{id}/capturar       capturar (se niega si ya se conoce)
POST /api/expectativas/eventos/{id}/expectativas   expectativa manual
POST /api/expectativas/eventos/{id}/resultados     reales desde EDGAR
GET  /api/expectativas/eventos/{id}                lectura completa
GET  /api/expectativas/calibracion                 calibración
```

`?symbol=` es opcional en `eventos` y `calibracion`: vacío (o solo espacios) significa «todos».
Un ticker se recorta y se pasa a mayúsculas; uno con caracteres no válidos (o con más de 12)
es un 422 con el mensaje «Símbolo inválido», el mismo en toda la API (`app/simbolos.py`).

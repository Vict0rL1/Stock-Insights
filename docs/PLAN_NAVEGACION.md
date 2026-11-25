# Plan de navegación (fase 3, ampliada)

Estado: **aprobado por Victor el 24 nov (las cuatro decisiones de abajo: sí) e implementado**
en la rama `claude/great-goodall-0k3gv0` (ver «Cómo quedó» al final). Maqueta navegable de las
cuatro pantallas clave: https://claude.ai/artifact/92HRFFRVxe7aakgGQz15Xj (datos de
demostración). Junto con la aprobación, Victor pidió «que las alertas de compra y venta sean
más claras»: es la sección «Avisos de compra y venta».

## Por qué

Petición del 24 nov: «para un usuario inexperto le costaría identificar cómo utilizar la
aplicación (…) hay demasiadas pestañas (…) quiero un diseño más simple en donde el usuario
logre entender fácilmente todo lo que está viendo». Lo que hay hoy:

- **15 entradas en el menú** en tres grupos (Hoy, Mercado, Acciones; siete herramientas;
  Portafolio, Cartera, Tesis, Vigilancia) y **11 pestañas en la ficha** de una empresa.
  Nada dice por dónde empezar.
- **La primera carga del día bloquea Hoy**: sin lista vigente en caché (6 h), la pantalla
  se queda en «Puntuando el universo…» mientras `/api/signals/today` descarga hasta 120
  fundamentales (`DEFAULT_FETCH_BUDGET`), un par de minutos con los límites gratuitos.
- Lo mismo aparece en dos sitios (exposición por sector y concentración en Portafolio y en
  Cartera; dos DCF con supuestos distintos) y las cifras técnicas no se explican.

## Principios del rediseño

1. **Una pantalla de inicio que contesta tres preguntas**: ¿pasa algo con lo mío?, ¿qué
   hay para invertir hoy?, ¿cómo está el mercado? Todo lo demás está a un toque.
2. **Primero la frase, después la cifra.** Cada veredicto empieza con una frase en
   lenguaje claro («Buena empresa frente a su sector, pero su precio va a la baja…»); la
   traza de reglas y los números siguen ahí, debajo. Los términos (stop, PER, momentum)
   llevan su explicación del glosario (`docs/GLOSARIO.md`).
3. **Nada bloquea.** Cada tarjeta carga por su cuenta y dice su estado; la puntuación del
   universo va en segundo plano con una barra de progreso.
4. **Las reglas de siempre no cambian**: ausente ≠ cero, UNKNOWN nunca es PASS, cada cifra
   con fuente y fecha, lo calculado y lo de la IA separados y etiquetados, sin precios
   objetivo. El rediseño no toca ninguna regla de decisión ni ningún umbral.

## Menú nuevo: de 15 entradas a 3 (+ avanzadas)

| Nuevo | Ruta | Qué contiene | Viene de |
|---|---|---|---|
| **Inicio** | `/` | Guía de tres pasos (se oculta), progreso del análisis, avisos urgentes (stop perforado, tesis rota), mercado en tres cifras, tu cartera en una línea por posición, las 3 mejores ideas (acciones / ETFs), «Pregúntale a la IA», próximos resultados y noticias | Hoy (cabecera, recuentos, «Mi cartera», panel de stops), Mercado (resumen) |
| **Explorar acciones y ETFs** | `/explorar` | Selector Acciones · ETFs. Acciones: la lista completa de Hoy con filtros por señal (Ideas de compra, Vigilar, Evitar, Todas), mercado y búsqueda; debajo, «Cómo se repartió el tamaño» y «Lo que NO comprar», plegados; y «Buscar con mis propios criterios», plegado. ETFs: recomendación, comparador y solapamiento | Hoy (lista), Screener, Multifactor, ETFs |
| **Ficha de empresa** | `/empresa/:symbol` | Cuatro pestañas (abajo) | Acciones (`/ticker/:symbol`) |
| **Mi cartera** | `/cartera` | Sub-pestañas Posiciones · Riesgo · Tesis y vigilancia (3.1 y 3.2; un solo bloque de exposición por sector y uno de concentración) | Portafolio, Cartera, Tesis, Vigilancia |
| **Herramientas avanzadas** | `/avanzado/…` | Mercado completo, Señales y backtest, Valoración DCF completa, Calendario de resultados, Noticias. Con el subtítulo «explora; no decide» y la nota «La decisión de compra sale de Explorar › Ideas de compra» (3.4) | Mercado, Señales, Valoración, Resultados, Noticias |

En el móvil, el menú pasa a una barra inferior con cuatro botones: Inicio, Explorar,
Cartera y Más (avanzadas). La búsqueda de empresa o ETF está arriba en todas las pantallas.

### Ficha de empresa: de 11 pestañas a 4

| Pestaña nueva | Qué junta |
|---|---|
| **Resumen** | «Qué dice la app» en una frase (veredicto, confianza y qué lo cambiaría), gráfico con su media de 200 sesiones, «Lo que comprueba la app» (la traza de `decision.py` resumida, con enlace a la completa), aviso de tesis rota y cuatro cifras clave explicadas. Botones: «Explícamelo con IA», «Avisarme si…», «Anotar una compra» |
| **Números** | Fundamentales, Salud y riesgo, Calidad de beneficios |
| **Valoración** | Resumen del DCF (un rango bajista · base · alcista) y «Abrir el análisis completo» (3.3) |
| **Novedades** | Qué cambió, Resultados vs expectativas, Filings y noticias de la empresa |
| *Más detalle (enlace)* | Informe completo, Opciones, Decisiones y replay |

Cómo quedó (fase B):

- La pestaña va en la URL: `?pestana=resumen|numeros|valoracion|novedades|detalle`, o el nombre
  de una sección (`salud`, `filings`…). Acepta también los once identificadores de antes; la
  tabla de traducción es `PESTANAS_VIEJAS` en `frontend/src/lib/pestanasFicha.ts` (con
  `pestanaNueva()` para las redirecciones). Números abre Fundamentales; Novedades, «Qué cambió»
  (que congela al abrirse, como antes); «Más detalle» no abre nada hasta elegir.
- «Qué dice la app» lee el análisis con `GET /api/empresa/{s}/analisis?congelar=false` (el
  parámetro ya existía): abrir la ficha no congela instantáneas. La frase sale de la traza del
  motor (`frontend/src/lib/queDiceLaApp.ts`), probada contra decisiones reales de `decide()`
  (`frontend/src/test/fixtures/decisiones_motor.json`, exportadas por el backend).
- «Explícamelo con IA» (solo con la IA encendida) abre «Más detalle › Informe completo» y pide
  su narrativa una vez. Los términos se explican con `components/Termino.tsx`, con las
  definiciones en `frontend/src/lib/glosario.ts`.

### Redirecciones (las rutas viejas siguen funcionando)

| Ruta vieja | Va a |
|---|---|
| `/hoy` | `/` |
| `/dashboard` | `/avanzado/mercado` |
| `/ticker`, `/ticker/:symbol` | `/explorar`, `/empresa/:symbol` (la pestaña vieja se traduce a la nueva) |
| `/screener`, `/multifactor` | `/explorar?filtros=abiertos` |
| `/etfs` | `/explorar?tipo=etfs` |
| `/portafolio` | `/cartera` |
| `/tesis`, `/vigilancia` | `/cartera?pestana=tesis` |
| `/senales`, `/valoracion`, `/resultados`, `/noticias` | `/avanzado/senales`, `/avanzado/valoracion`, `/avanzado/resultados`, `/avanzado/noticias` |

## La primera carga, sin bloquear

1. **Inicio no espera a la lista.** Mercado, cartera, avisos de stop y calendario son
   peticiones aparte y se pintan en cuanto llegan; la tarjeta de ideas dice su propio
   estado.
2. **Lista anterior mientras se recalcula.** Si hay una lista guardada pero caducada (más
   de 6 h), se sirve al momento con su antigüedad («lista de hace 9 h; actualizando…») y la
   nueva la sustituye al llegar. Contrato: `/api/signals/today` acepta `vencida=aceptar`
   y devuelve la copia de `get_vencido` con `estado: "viejo"` y `antiguedad_segundos`, sin
   congelar instantáneas nuevas (una lista servida es la decisión de cuando se calculó,
   como ya hace la caché). Sin copia, 404 y la pantalla espera a la normal.
3. **Primera vez de todas** (sin ninguna lista): la primera pasada usa un presupuesto
   menor, para enseñar resultados en segundos, y las pasadas automáticas que ya existen
   (`MAX_PASADAS_AUTO`) completan el resto con la barra «312 de 502 empresas».

## La IA

- Se mantienen los botones de IA que ya hay por pantalla (informe, «qué cambió», noticias,
  señales), con el mismo nombre en todas: «Explícamelo con IA».
- **Nuevo, opcional (fase D):** «Pregúntale a la IA» en Inicio. Endpoint
  `POST /api/ia/preguntar` que manda a Claude la pregunta junto con lo ya calculado del día
  (lista, cartera, mercado) y nada más; enseña el coste estimado antes de enviar
  (`CosteEstimado`) y la respuesta sale aparte con la etiqueta «IA». Sin clave, el bloque
  explica cómo añadirla en vez de desaparecer.

## Endpoints afectados

- `/api/signals/today`: parámetro nuevo `vencida` (arriba). README y `docs/PORTFOLIO_RISK.md`
  se actualizan en el mismo commit.
- `/api/stocks/{s}/valuation/dcf` y `/api/stocks/{s}/valuation/defaults`: alias obsoletos
  durante una versión (3.3, hecho); la ficha pasa a `/api/valuation/{s}` y el módulo abre con
  `?simbolo=` (`rutaValoracion`, `components/valoracion/ruta.ts`; la redirección de
  `/valoracion` a `/avanzado/valoracion` debe conservar la consulta). El `dcf` de
  `/api/deep-dive/{s}` pasa a la forma del módulo (`escenarios`, `rango_global`, `entradas`).
- `/api/ia/preguntar`: nuevo, solo en la fase D.
- Ningún otro endpoint cambia: las pantallas nuevas reúnen los que ya existen.

## Tests y golden master

- **Golden master:** no cambia. No se toca ninguna regla, umbral ni cálculo; en 3.3 el
  golden `dcf_ficha` debe seguir dando igual (condición de FIX_PLAN).
- **Frontend:** se reescriben `Layout.test.tsx` (menú) y las pruebas que navegan por ruta
  (`cargas.test.tsx`, `VigilanciaPage.test.tsx`); un test por redirección; tests de Inicio
  (cada tarjeta carga sola, avisos, guía que se oculta y se recuerda), de Explorar
  (filtros por señal) y de la ficha (cada pestaña vieja encuentra su sitio). Los tests de
  los componentes que se reutilizan siguen valiendo.
- **Backend:** tests de `vencida=aceptar` en `test_today.py` (sirve la copia con su edad,
  no congela, 404 sin copia).
- **Capturas:** `frontend/scripts/capturas.ts` cambia sus rutas; se conservan las guardas
  (sin desbordes ni textos partidos a 390 px).

## Orden de trabajo

| Fase | Qué | Se puede revisar con |
|---|---|---|
| A | Menú nuevo, redirecciones, Inicio con las tarjetas que ya existen, carga sin bloqueo | Capturas de Inicio a tres anchos |
| B | Ficha en cuatro pestañas y frases en lenguaje claro con glosario | Capturas de la ficha |
| C | Explorar (lista, filtros, ETFs) y Mi cartera (3.1, 3.2) | Capturas y tests de redirección |
| D | «Pregúntale a la IA» y el DCF único (3.3) | Tests del endpoint y golden `dcf_ficha` |

## Decisiones para Victor (respondidas el 24 nov: sí a las cuatro)

1. ¿Apruebas el menú de tres entradas más «Herramientas avanzadas» y la ficha en cuatro
   pestañas? **Sí.**
2. ¿Se puede servir la lista anterior, con su antigüedad, mientras se recalcula? **Sí.**
3. «Pregúntale a la IA» libre (endpoint nuevo, gasta API): ¿sí, o bastan los botones de IA
   de cada pantalla? **Sí.**
4. El DCF único (3.3): ¿entra en este rediseño o después? **En este.**

## Avisos de compra y venta

Cada idea y cada posición dice UNA cosa que hacer (`frontend/src/lib/avisos.ts`, pintada por
`components/AvisoDeAccion.tsx`): comprar, comprar sin sitio («Buena idea, pero hoy no cabe en tu
cartera»), esperar, evitar, vender, reducir, mantener o sin comprobar (verbo «Revisar»). Verbo
grande con icono y color (nunca solo color), una frase y las cifras para actuar. Las frases salen
solo de lo que ya decide el motor (acción, niveles, traza, `cambiaria`, peso final, recortes y
repaso del stop): ninguna regla ni umbral nuevo. Sin precio nunca es «mantener»; tampoco, con
repaso o sin él, con un precio viejo o con la regla del stop sin evaluar: es «Revisar». «Para
vender» cuenta los mismos avisos que el panel, por construcción. Una empresa de la lista pide su
aviso a `avisoDeLaFila` (su fila, su tarjeta de idea, el recuento «sin sitio»): con su stop si ya
la tienes y su tamaño si está en la lista corta. Con `shortlist.sin_hueco_de_riesgo` (la cartera
que ya tienes supera sola el objetivo de volatilidad), las que califican fuera de la lista corta
tampoco caben: «Sin sitio», no «Comprar» (revisión 15).

## Cómo quedó

| Pieza | Commit | Notas |
|---|---|---|
| Menú, rutas, redirecciones, Inicio, Explorar, Avanzado | `d4779c6`, `93bdc88`, `0705045`, `c837d14` | Rutas en `lib/rutas.ts`; las viejas redirigen con su consulta |
| Avisos de compra y venta | `5e1e03a` | En Explorar e Inicio |
| Carga sin bloqueo | `2b49c66` | `vencida=aceptar`, `useListaDiaria`, `ProgresoAnalisis`; el presupuesto de descargas cuenta también EDGAR |
| Mi cartera (3.1, 3.2) | `10ac2d2` | Posiciones · Riesgo · Tesis y vigilancia; se borran las cuatro páginas viejas |
| Un solo DCF (3.3) | `c5a9806` | Comparación de supuestos en el README, «Un solo DCF» |
| Pregúntale a la IA | `da31da5` | `POST /api/ia/preguntar` y `/coste` |
| Ficha en cuatro pestañas | `0fe65c2` | Pestañas viejas → nuevas en `lib/pestanasFicha.ts`; «Qué dice la app» con el mismo aviso que Inicio |

Explorar › Acciones (revisión 15): filtros Mejores ideas, Todas las que califican, Vigilar,
Evitar, Mi cartera y Todas; «Cómo se repartió el tamaño» y «Lo que NO comprar», plegados (el
del tamaño se abre solo si hay un límite sin comprobar o una cartera sin valorar, y su resumen
lo dice). Controles de 44 px a 390 px.

Diferencia con el plan: Inicio no tiene «las 3 mejores ideas en ETFs» porque la app no tiene un
universo de ETFs que puntuar; la pestaña ETFs explica qué es un ETF y lleva al comparador con los
que escriba el usuario (`/explorar?tipo=etfs&simbolos=…`).

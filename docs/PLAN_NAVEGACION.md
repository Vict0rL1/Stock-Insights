# Plan de navegación (fase 3, ampliada)

Estado: **propuesta, pendiente de aprobación de Victor.** No se cambia ninguna ruta hasta
que esté aprobada (`docs/FIX_PLAN.md`, fase 3). Maqueta navegable de las cuatro pantallas
clave: https://claude.ai/artifact/92HRFFRVxe7aakgGQz15Xj (datos de demostración).

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
- `/api/stocks/{s}/valuation/dcf`: alias obsoleto durante una versión cuando entre 3.3; la
  ficha pasa a `/api/valuation/{s}`.
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

## Decisiones para Victor

1. ¿Apruebas el menú de tres entradas más «Herramientas avanzadas» y la ficha en cuatro
   pestañas?
2. ¿Se puede servir la lista anterior, con su antigüedad, mientras se recalcula?
3. «Pregúntale a la IA» libre (endpoint nuevo, gasta API): ¿sí, o bastan los botones de IA
   de cada pantalla?
4. El DCF único (3.3): ¿entra en este rediseño o después?

# Progreso del plan de correcciones (`docs/FIX_PLAN.md`)

Una línea por ítem. Al cerrar cada commit: marcar, poner estado, hash y una nota de una línea.
Estados: `pendiente` · `en curso` · `hecho` · `parcial` · `necesita a Victor`.

Material de partida: `docs/REVISION_GENERAL.md` (revisión del 8-oct-2026) y sus 25 capturas en
`docs/revision/` (el conjunto «antes»).

**Hashes.** Las filas de las Fases 0 y 1 (ítems, R1–R13, S1–S14) citan los identificadores del
repositorio anterior, que aquí no existen: `docs/EQUIVALENCIAS_COMMITS.md` da el nuevo de cada uno
(ver `HANDOFF.md`). La tabla de cierres y todo lo escrito desde el 2026-10-09 usan los de este
repositorio.

## Fase 0 — Red de seguridad

- [x] **0.1** Tests de frontend (Vitest + Testing Library + jsdom, `npm test`) — estado: hecho · commit: `a3aa047` · nota: vitest 5 + jsdom 30; tests junto al código (`*.test.tsx`), también pasan por `tsc -b`.
- [x] **0.2** Integración continua (`.github/workflows/ci.yml`) — estado: hecho · commit: `1fa46c5` · nota: ESLint nuevo (recomendado, pasa limpio); ruff laxo (E9/F63/F7/F82); `tsc -b` en vez de `tsc --noEmit` (el tsconfig raíz no comprueba nada); auditorías solo informan.
- [x] **0.3** Golden master del motor (`backend/tests/golden/`) — estado: hecho · commit: `9439108` · nota: 9 componentes, reloj congelado con time-machine; 12 umbrales con prueba de sensibilidad; regenerar solo con visto bueno (`python -m tests.golden.generar --escribir`). Ampliado en el commit de 0.5 (veredictos largos y Hoy con cartera), comprobado que lo anterior no cambió.
- [x] **0.4** Paquete de casos extremos (`backend/tests/fixtures/extremos/`) — estado: hecho · commit: `1c99295` · nota: 8 empresas, 5 carteras, 3 listas diarias; `tests/test_extremos.py` comprueba que cada caso provoca su rareza.
- [x] **0.5** Tests contra fugas de texto (backend y frontend) — estado: hecho · commit: `0c6ec32` · nota: trinquete con PENDIENTES por ítem (backend 11, frontend 19); respuestas reales exportadas para el frontend (`python -m tests.fixtures.exportar_frontend`).
- [x] **0.6** Capturas repetibles con un solo comando — estado: hecho · commit: `399d9eb` · nota: `cd frontend && npm run capturas -- <salida>`; 5 escenarios, 85 capturas, reloj congelado en backend y navegador.
- [x] **0.7** Grabar y reproducir respuestas reales de proveedores — estado: hecho (falta grabar con claves: **necesita a Victor**) · commit: `4f6042e` · nota: `python scripts/validar_con_datos_reales.py --grabar`; los tests de contrato se saltan hasta que haya grabaciones; la tubería está probada sobre una red simulada.
- [x] **0.8** Copia de seguridad de la base en `start.sh` — estado: hecho · commit: `7b8994f` (rehecho tras la revisión, ver R7) · nota: `app/db/copia.py` (API de copia de SQLite), 10 últimas en `copias/` junto a la base; la llaman `start.sh`, `migrar()` y un `alembic upgrade` a mano.
- [x] **0.9** Repaso rápido de seguridad — estado: hecho · commit: `5eee473` · nota: tipo común de ticker en 46 parámetros (6 rutas no validaban); «/api/etfs/recomendar» estaba tapada por «/{symbol}» (arreglado); CORS e historial ya limpios; host 127.0.0.1 explícito; npm audit sin avisos.

## Fase 1 — Corrección y fallos visuales (P1)

- [x] **1.1** Tokens semánticos de color mínimos + `leerToken` + test de contraste — estado: hecho · commit: `90924e9` · nota: 14 tokens en `index.css`; `--text-muted` = #808eab (el #7c8aa8 del plan daba 4,37:1 sobre la superficie hundida); el test lee `index.css`; los rótulos `slate-400` existentes tienen el mismo 4,37:1 → para 2.13/4.1.
- [x] **1.2** V1 · colores del gráfico de precios — estado: hecho · commit: `bfba8f9` · nota: velas, rejilla, ejes, separadores de panel, RSI, MACD, medias y leyenda desde tokens (`leerToken`); volumen al 35 % en la quinta parte de abajo; logo con `var(--info)`; minigráficos, curva y matriz ya iban por clases invertidas (verificado en capturas). Guarda: ningún hexadecimal en `src/`. Pendiente fuera de V1: etiquetas de eje que se pisan entre paneles.
- [x] **1.3** V9 · etiquetas de IA — estado: hecho · commit: `9c68e0f` · nota: `components/ia/ContenidoIA.tsx` (etiqueta, bloque y botón con `--ai`/`--ai-bg`) sustituye 4 copias; también la píldora «IA activa». Hermanos: `text-amber-700` (3,45:1, 10 ficheros) → `amber-800`; `text-sky-950` dejaba invisible el coste antes de gastar en IA → `sky-900`. Guardas: fondos 50/100 y textos 700–950 solo si `index.css` los invierte; nada `violet-*` suelto. Test de render con IA presente.
- [x] **1.4** V3 · «undefined %» en el reparto del tamaño — estado: hecho · commit: `fc7e0d6` · nota: estado vacío «Hoy no hay candidatas que dimensionar»; campos del reparto opcionales en `types.ts`; «Ya en cartera» ya no rellena con 0. Guarda: ESLint con tipos (`restrict-template-expressions`, sin nulos en plantillas), que destapó 3 hermanos (modelo de IA, errores seguidos de alertas, precio en la barra de valoración). Trinquete: fuera la fila de `undefined`.
- [x] **1.5** V11 · contradicción en «Deuda y solidez» — estado: hecho · commit: `62f3b08` · nota: la lectura solo miraba deuda/capital y cobertura; ahora «sin datos» solo si faltan los cuatro datos de la sección, y si no dice lo que hay y nombra lo que falta. Deuda parcial dicha como en la Ronda 2 (nota y marcador compartido con Salud).
- [x] **1.6** V18 · etiquetas de ventana fija (5A, 10A, TTM) — estado: hecho · commit: `e70f3a8` · nota: el informe, Fundamentales y las dos valoraciones rotulaban «5A» una tasa calculada con los años que hubiera (uno en ACME); ahora `<Ventana>` dice la ventana real y la marca «parcial» si es corta, y la lectura del backend la nombra. Hermanos: el prompt del informe IA decía «CAGR 5A» con la ventana corta; la aceleración (5A frente a 3A) se calculaba con 3 años o menos, donde las dos tasas coinciden. Se quedan como están las cifras cuya ventana define el proveedor (`revenue_growth_5y`/`eps_growth_5y` de Finnhub, bono a 5 años de FRED). Guardas: tests de lectura y prompt en el backend; render del informe con la respuesta real de ACME.
- [x] **1.7** V4, V5, V8 · un solo sistema de formato (`formato.py` / `formato.ts`) — estado: hecho · commit: `00c5b77`, `4796384` · nota: módulos gemelos con una tabla de casos compartida (pytest y Vitest dan la misma cadena; el backend redondea como ICU). Frontend migrado en `00c5b77` (V5 y V8 en pantalla); backend aquí: 256 formatos sueltos y las cifras crudas («EPS estimado 0.52», «≥ 0.7», «90.0») pasan por `formato.py`. Hermanos: rótulos «media 200 ± X %» escritos a mano (ahora salen de la constante); `eps_estimate` 0,0 descartado por *falsy*; «de hace 0 min» y «nuevas 0» con el dato ausente; «€» y «B$» en ETFs sin moneda; cifras crudas en el prompt del informe IA (un `None` llegaba tal cual); con dos divisas, importes sin código en la cartera. Guardas: tabla compartida; test AST (especificadores, `round()` y constantes decimales crudas, 3 internos con motivo); ESLint contra `toFixed`/`toLocaleString`/`Intl`; patrón `decimal_punto` en los dos trinquetes de fugas. Fuera del trinquete las 6 filas del 1.7.
- [x] **1.8** V6 · identificadores internos, diccionario de etiquetas y `docs/GLOSARIO.md` — estado: hecho · commit: `2ad459b` · nota: un diccionario (`app/etiquetas.py`) con copia exportada al frontend y casos que demuestran que los dos etiquetan igual; fuera 11 diccionarios locales del frontend (dos `FAMILY_LABELS` idénticos entre ellos). Orígenes «analisis:14:35:00» → «análisis de las 14:35 UTC»; códigos desconocidos legibles y con aviso. Hermanos: «(modelo_interno)» dentro de frases de Expectativas; la regla anti-anticipación del replay en código; «net_debt» en un error; «EPS»/«Div. yield»/«Expense ratio» en pantalla. Guardas: exhaustiva (enums del backend + cada clave del paquete que emite códigos, clasificada como mostrada o interna); copia al día; etiquetas = tabla de materialidad de «Qué cambió»; glosario con columna «Nunca» que un test aplica a backend, frontend y diccionario. Fuera de los trinquetes las 11 + 37 filas del 1.8.
- [x] **1.9** V7 · gramática, plurales y concordancia — estado: hecho · commit: `5a4f217` · nota: `plural()` en `formato.py`/`formato.ts` (con casos en la tabla compartida); 21 frases del backend y 8 del frontend con su plural y el verbo y el adjetivo concordando («1 posición abierta no entra»). Los cuatro de la revisión: «una puntuación válida», «el punto salta si cae por debajo de 0,180», «El único punto de invalidación no se ha cruzado», «posición(es)». Hermanos: «1 de 3 puntos se han cruzado», «Ninguno de los 1 titulares», «1 no se pudieron comprobar», «undefined cambio(s)» si faltaba el recuento. Guardas: los cuatro casos (fallan con el código anterior); los trinquetes de fugas quedan VACÍOS en los dos lados.
- [x] **1.10** V13 · mensajes desfasados — estado: hecho · commit: `17d0b76` · nota: la lista diaria y la de sectores, cuando no puntúan, cuentan los motivos reales de cada empresa (`unavailable` y pendientes) en vez de «Revisa que FINNHUB_API_KEY…» (la puntuación sale de EDGAR); README sin «sin Alembic por ahora». Hermano: el calendario del panel de mercado tragaba el error y pintaba «Sin eventos (¿falta FINNHUB_API_KEY?)»; ahora un fallo se dice como fallo. Barrido: el resto de menciones a Finnhub son ciertas (pares, calendario, consenso). Guardas: test de la API con todo fallando (falla con el mensaje anterior) y render del calendario con fallo y con lista vacía.
- [x] **1.11** Modelo de Claude configurable — estado: hecho · commit: `34b23d3` · nota: `CLAUDE_MODEL` (por defecto `claude-sonnet-5-5`; `claude-opus-5-5` como alternativa; `ANTHROPIC_MODEL` se sigue leyendo como alias para no ignorar un .env existente); fuera el `claude-opus-5` escrito en `config.py` y en el proveedor. Un 404 del API (`NotFoundError`) da «Modelo de Claude no válido: <id>. Revisa CLAUDE_MODEL en .env.» en interpretar y en extraer. Hermano: la estimación de coste de Resultados usaba la tarifa de Opus 5 fuera cual fuera el modelo; ahora va por modelo y, sin tarifa conocida, no se inventa. Documentado en README y `.env.example`. Guardas: tests de configuración, del 404 y de la tarifa.
- [x] **1.12** Límites de plausibilidad del tipo de cambio — estado: hecho · commit: `02e6fc3` · nota: las bandas ya existían (`fx.BANDAS_POR_USD`, Ronda 2) pero solo se miraban al convertir, con la serie ya en caché: una serie del revés se rechazaba en cada lectura sin probar otra fuente. Ahora `validacion.py` la rechaza al recibirla (`fx.comprobar_serie`, mediana de la serie, la MISMA banda: sin copiarla ni moverla), como un NaN. Bandas sin tocar (las del plan, 0,85–1,75 para CAD, son más estrechas que las vigentes y el plan prohíbe cambiar umbrales). Guardas: serie invertida rechazada, buena aceptada, dato raro suelto aceptado, serie no FX sin mirar, y el router pasa a la siguiente fuente (los dos clave fallan con el código anterior).
- [x] **1.13** Validación con datos reales — estado: hecho · commit: `0e0c3df` · nota: `./start.sh validar` (no arranca servidores; pasa los argumentos al script) y `--informe`: `backend/data/validacion/validacion_AAAAMMDD.md` con cada PASS/FAIL/UNKNOWN, lo comparado y qué mirar a mano, más la lista manual del §13. **No se pudo correr con datos reales aquí** (el contenedor no tiene claves ni salida a los proveedores): queda para Victor, `./start.sh validar`. Comprobado de punta a punta contra una base temporal en modo `--solo-cache` (todo UNKNOWN con su motivo). Guardas: contenido y nombre del informe; `start.sh validar` con un python falso (argumentos y carpeta) y sin entorno.

## Fase 2 — Claridad y uso diario (P2)

- [x] **2.1** `<EstadoDato>` y estados de carga, vacío y error — estado: hecho (tres revisiones independientes, todas arregladas; capturas 1440/390 repetidas, 66 sin fallos) · commit: `d05312c`, `c9eea22`, `d238798`, `9b84525` y el de la tercera pasada (abajo) · nota: `lib/useDato.ts` (cargando/listo/error, reintento, sin respuestas viejas al cambiar de clave) y `components/EstadoDato.tsx` (`EstadoDato` con los cuatro estados del backend, antes `SourceBadge`; `BloqueDatos` y `ErrorDeCarga` con «Reintentar»). Todas las cargas al montar del frontend pasan por ahí: 23 manejadores de error que no miraban el error (fallo pintado como vacío o callado) y los estados ad hoc de unas 30 cargas. La ficha se pinta sin cotización. Tras la revisión: cada carga va atada a su clave (ni un render con los datos de otra), `refrescar()` recarga tras una acción sin vaciar la pantalla, y `ausenteSi404` + `BloqueDatos ausente` dicen un 404 («la fuente no lo tiene») como ausencia, sin «Reintentar». Guardas: ESLint marca un `.then`/`.catch` cuyo manejador no recibe el error, un `catch {}` sin parámetro y una promesa flotante; 73 tests de render en `d05312c` y 37 más en la revisión (todos fallan con el código anterior salvo las guardas rotuladas).
- [ ] **2.2** V14 · `AvisoAgrupado` — estado: pendiente · commit: — · nota: —
- [ ] **2.3** Tipografía (mínimo 12 px, `<TituloPagina>`, `<TituloTarjeta>`) — estado: pendiente · commit: — · nota: —
- [ ] **2.4** V15 · `<BarraExposicion>` — estado: pendiente · commit: — · nota: —
- [ ] **2.5** V16 · aprovechamiento del espacio (matriz, tablas) — estado: pendiente · commit: — · nota: —
- [ ] **2.6** V10 · pestañas de la ficha (6 + «Más ▾») — estado: pendiente · commit: — · nota: —
- [ ] **2.7** V12 · estado de la tesis trimestral y anual — estado: pendiente · commit: — · nota: —
- [ ] **2.8** V17 · logo de TradingView y atribución — estado: pendiente · commit: — · nota: —
- [ ] **2.9** Modo resumen — estado: pendiente · commit: — · nota: —
- [ ] **2.10** Editar tesis, varias watchlists, exportar CSV — estado: pendiente · commit: — · nota: —
- [ ] **2.11** Vista global «qué cambió en mis posiciones» — estado: pendiente · commit: — · nota: —
- [x] **2.12** V2 · diseño móvil — estado: hecho (adelantado por la auditoría del 19 oct, A7; detalle en su sección) · commit: el de A7 · nota: por debajo de 768 px la barra lateral es un cajón («Menú»); las capturas a 390 px fallan si una pantalla desborda en horizontal o parte un texto palabra a palabra, y ya no pulsan «a la fuerza».
- [ ] **2.13** Accesibilidad (axe-core, foco, aria-label, color no único) — estado: pendiente · commit: — · nota: —
- [ ] **2.14** Rendimiento medido de Hoy — estado: pendiente · commit: — · nota: —

## Fase 3 — Estructura (plan primero, `docs/PLAN_NAVEGACION.md`, esperar aprobación)

- [ ] **3.1** Fusionar Portafolio y Cartera — estado: pendiente · commit: — · nota: —
- [ ] **3.2** Fusionar Tesis y Vigilancia — estado: pendiente · commit: — · nota: —
- [ ] **3.3** Un solo DCF — estado: pendiente · commit: — · nota: —
- [ ] **3.4** Jerarquía de rankings («Investigar») — estado: pendiente · commit: — · nota: —

## Fase 4 — Salud del código (P3)

- [ ] **4.1** Migración completa a tokens — estado: pendiente · commit: — · nota: —
- [ ] **4.2** Partir ficheros grandes sin cambiar comportamiento — estado: pendiente · commit: — · nota: —
- [ ] **4.3** Partir el README — estado: pendiente · commit: — · nota: —
- [ ] **4.4** Fuente Inter autoalojada y cifras tabulares — estado: pendiente · commit: — · nota: —
- [ ] **4.5** Linting más estricto y mypy con línea base — estado: pendiente · commit: — · nota: —
- [ ] **4.6** `CLAUDE.md` con las convenciones nuevas — estado: pendiente · commit: — · nota: —

## Cierres de fase

| Fase | Etiqueta de inicio | Revisión independiente | Capturas «después» | Etiqueta de cierre |
|---|---|---|---|---|
| 0 | `fase-0-inicio` = `de14316` | hecha: 13 hallazgos, 12 arreglados y 1 para Victor (R1–R13, abajo) | no toca pantallas (las capturas de 0.6 se verificaron) | `fase-0-hecha` = `877428d` |
| 1 | `fase-1-inicio` = `877428d` | hecha: el revisor dio 4 listas (A–D); 14 grupos arreglados (S1–S14) y 4 para Victor o la Fase 2 (abajo) | `docs/revision/despues-fase1/` (66, todas a 1440 y 390; comparadas con `revision/`) | `fase-1-hecha` = `f2c2af9` |
| 2 | `fase-2-inicio` = `f2c2af9` | — | — | — |
| 3 | — | — | — | — |
| 4 | — | — | — | — |

## Revisión independiente de la Fase 0

Veredicto del revisor: «no se puede cerrar tal cual»; ninguna violación cambia decisiones, pero
la red de seguridad tenía agujeros. Cada hallazgo, su arreglo y su commit:

| # | Hallazgo | Estado | Commit |
|---|---|---|---|
| R1 | El golden descartaba códigos con tildes o espacios (`limite: "posición"`, `faltan: ["puntuación"]`…) | hecho: se guardan; un texto sin clasificar es un error | `4742548` |
| R2 | 14 umbrales (confianza, calidad) y los de `sizing` por defecto sin cubrir | hecho: inventario automático de 117 constantes, 95 cubiertas con prueba, 22 exentas con motivo | `4742548` |
| R3 | `generar.py` y `exportar_frontend.py` con `setdefault(DATABASE_PATH)` | hecho: asignación | `4742548` |
| R4 | El trinquete de fugas cuenta por token, no por sitio ni recuento | hecho: por sitio y con recuento (backend 30 filas, frontend 55); el frontend congela el reloj, exige un botón de replay por instantánea y pinta también cabecera, informe, valoración y portafolio | `e7cc849` |
| R5 | El servidor de demostración inventa datos para VACIA y usa `or 0` | hecho: `ServicioPantallas` completa sin inventar; la demo solo inventa fuera del paquete | `3807b51` |
| R6 | `capturas.ts` sale con 0 ante fallos; `scripts/` fuera de ESLint y tsc | hecho: lista de fallos y código 1 (botón ausente o «Cargando…» a los 15 s cuentan); `tsconfig.scripts.json` y ESLint con globals de Node | `95d7efb` |
| R7 | La copia de la base se salta en silencio (`backend/.env`, espacios, otros caminos que migran) | hecho: una sola implementación en Python que resuelve la ruta como el backend; copia también `migrar()` y `alembic upgrade`; aviso si no hay base; adiós `copia_base.sh` | `95d7efb` |
| R8 | `?symbol=` vacío y con espacios pasó a 422 sin documentar; validadores duplicados; `client.ts` sin codificar | hecho: los tipos normalizan (vacío = sin filtro, recorte, mayúsculas, «A, B» en listas); un solo validador (`validar_simbolo`), adiós a 9 copias y 13 alias; 28 URLs codificadas y guarda; `related` con varios tickers → el primero | `a0f0255` |
| R9 | Tests de contrato que pasan en vacío; unidades | hecho: datos obligatorios por empresa (falla si se grabó con claves caducadas); unidades por cociente (P/S, BPA, márgenes en fracción, capitalización); `null` grabado; grabación que cruza la medianoche se rechaza | `9a71543` |
| R10 | Casos extremos que no son lo que dicen (`solo_cache_viejo`, `precio_nan`) | hecho: descripciones honestas (el rescate real lo prueba `test_e2e_ciclo`, escenario E); caso nuevo `precio_nan_sin_historico`; el paquete ya no importa de `test_scan` | `9a71543` |
| R11 | Huecos de `test_seguridad.py` (símbolos buenos, rutas tapadas entre routers) | hecho: buenos por query, lista y cuerpo; vacío no es 422; solo 422 (no 404) para los malos; rutas tapadas con el orden real de registro | `a0f0255` |
| R12 | `/api/etfs/recomendar` sin verificación visual; README dice POST | hecho: ETF ficticios en la demo y captura `22b_etfs_recomendar` (1440 y 390, verificada); README con GET | `95d7efb` |
| R13 | El tipo de cambio de la cartera usa la hora real | **necesita a Victor**: anotado abajo (arreglarlo cambia el replay) | — |

## Revisión independiente de la Fase 1

| # | Hallazgo | Estado | Commit |
|---|---|---|---|
| S1 | 23 porcentajes del frontend escritos `${fmtNum(x, 1)} %`, con espacio normal (el «%» puede caer solo en la línea siguiente); visto al preparar la revisión | hecho: `fmtPct(…, { enPuntos })`, con `signo` donde se pintaba el «+» a mano (adiós a un `?? 0` de signo). Hermano: la distancia de «qué la cambiaría» (`falta +3,00 )` sin unidad, espacio normal con ella). Guarda: regla de ESLint (plantillas, JSX y literales que empiezan por « %») y test de render. Hermano en el backend: `experiments.py` («Último 30 % …» con `int()`); la guarda AST ahora ve un «%» con espacio normal tras una interpolación | `cc5ed78`, `492571a` |
| S2 | Códigos en crudo con `replace(/_/g, ' ')` en cinco pantallas: «LOW VOLATILITY» (Cartera), «working capital over assets» (Altman Z), «cfo inicio» / «change receivables» / «cuentas por cobrar_anterior» (Calidad), «Realestate» (sectores de un ETF), «guidance al alza» (Señales); visto al comparar las capturas | hecho: los cinco con `etiqueta()`; 47 etiquetas nuevas; el diccionario se consulta antes de decidir si algo es código (la clave «cuentas por cobrar_anterior» está congelada en el golden y no se toca). Guardas: regla de ESLint contra `replace(/_/g…)` fuera de `etiquetas.ts` (ve los 5); el test exhaustivo cubre las claves de las entradas de calidad, los componentes de Altman, los eventos de noticias y los sectores de yfinance (falla sin las etiquetas) | `e87e67e` |
| S3 | Seis cifras compactas a mano (`fmtNum(x / 1e6, 1) + ' M'`) en Valoración, Qué cambió, Expectativas y Calidad: sin «mil M» y con espacio normal | hecho: `fmtCompacto`. (Con un dato ausente pintarían «0 M», pero el backend ya responde 422 antes; no llegaba a pasar.) Guarda: regla de ESLint contra dividir por un literal ≥ 100.000 fuera de `formato.ts` (ve los seis) | `105d39f` |
| S4 | Recuentos sin `plural()` (revisor D1, C2, C7): «1 empresas cumplen», «aquí están las 1», «queda 1 puntos», «comprada hace 1 días», «1 minutos», «vez/veces», «1 operaciones seguidas», «0 de 1 parejas», «publicado hace None días» y «último trimestre (None)» en la confianza; en pantalla «+1 sobre 1 evaluables», «1 años», «1 empresas puntuadas», «1 observaciones», «hace 0 días» (Tesis) y «hace 10 min · hace 0 días» (Vigilancia); CAGR de BPA y FCF sin su ventana | hecho: `plural()` en los dos lados; «hoy» para 0 días; Tesis y Vigilancia con `fmtAntiguedad`; la ventana en los tres CAGR. Guardas: patrón `uno_plural` en los dos trinquetes de fugas (encontró «0 de 1 parejas» en el dimensionador, que nadie había visto) y test de los recuentos en `test_gramatica.py` (fallan sin el arreglo) | `7fe1398` |
| S5 | (revisor A1) El stop de una idea nueva salía «+12,8 %» en la tarjeta y «-12,8 %» en el disparador: `stop_pct` tiene dos convenios (distancia en una idea nueva; con signo sobre una posición) | hecho: `distanciaAlStop()` según `owned`; un stop perforado sigue positivo. Tipo documentado. Guarda: test | `940e18f` |
| S6 | (revisor A2) El replay con 0 marcas decía «Sin información posterior: 0 marcas comprobadas»; lo sin fecha verificable no salía | hecho: «No se pudo comprobar…»; lo sin fecha se nombra y quita la garantía. Guarda: test de render | `f21c559` |
| S7 | (revisor A3) Una cartera toda en CAD, o USD con una fila CAD sin tipo, salía sin códigos de moneda y con «no hay nada que convertir» | hecho: mezcla = alguna divisa distinta de la base en pantalla; nota y panel con el recuento real. Guarda: tests de fx y de pantalla. El paquete de casos extremos ya traía el caso (SHOP.TO) | `6dca25a` |
| S8 | (revisor A5, B3, D6, D7) «BPA» salía «Bpa» (la métrica que extrae la IA); «reforzar»/«descartar» sin etiqueta y en crudo en el desplegable; `codigo in ETIQUETAS` cierto para «toString»; diccionarios paralelos (fuentes de expectativas, tendencias, escenarios, márgenes, «deuda a largo plazo» frente a «deuda a largo») y `_anos` a mano | hecho: una sigla se deja («EPS» → «BPA», glosario); `ACCIONES_REGISTRADAS` con etiqueta y en el test exhaustivo; `Object.hasOwn`; los paralelos pasan por `etiqueta()` (la procedencia de cada fuente queda aparte); deuda «a corto/largo plazo» en todo el diccionario; `plural()`. `GLOBAL` de Calidad se queda: concuerda con «calidad» («DESCONOCIDA»). Guardas: tests de siglas (los dos gemelos, con paridad), del prototipo y del enum (fallan sin el arreglo) | `8ffec21` |
| S9 | (revisor A4, B7, B8) SMA 200 y RSI pintados con `--ai`, el color de lo generado por IA | hecho: token `--indicador`; contraste de `--text` sobre `--ai-bg`. Guarda: test que solo deja usar `--ai` a ContenidoIA y a la barra del API | `f3e1427` |
| S10 | (revisor C1, C3, C4, C5, C8) «DATO VIEJO · hace 0 min» sin antigüedad; recuento de «Qué cambió» que desaparece; «Calculado —»; hora local sin rótulo junto a «14:35 UTC» en el replay; «zona None» y «None/9» en el prompt del informe | hecho: cada hueco se dice; el replay en UTC rotulado. Guarda: test de la insignia | `e3dd6ad` |
| S11 | (revisor C6, D2) «sin fundamentales o cuota agotada» para todo; «¿falta FRED_API_KEY?» ante cualquier fallo (y mientras cargaba); el 404 de modelo tragado al estimar el coste | hecho: motivo del router; estados de error y carga de FRED; «Modelo de Claude no válido» también al estimar. Guardas: tests | `aadd0d7` |
| S12 | (revisor A7, B1, B5) «Sharpe (0.83)», «alfa 0.05»; numpy y Decimal salían «—»; un instante futuro era «hace segundos»; `Intl.NumberFormat()` sin `new` escapaba a ESLint | hecho: `fmt_num`; `_cifra()` acepta numpy/Decimal; más de 5 min en el futuro = «con fecha futura» (gemelos y tabla); ESLint ve la llamada sin `new`. Guardas: tests y casos de tabla | `f6f3d59` |
| S13 | (revisor D4) Ejes y cruz del gráfico en inglés («123.45», «1.2M», «12 Sep '26») | hecho: `LOCALIZACION` y volumen con `fmtCompacto`; fecha de barra diaria en UTC. Guarda: test | `d97b44a` |
| S14 | (revisor D3, D5) Unas 30 fechas ISO en pantalla y en frases del backend; la hora de una cotización sin la zona del mercado | hecho: `fmtFecha`/`fmt_fecha` en todas; ET para la hora del dato de mercado. Multifactor no: sus «desde–hasta» son ejercicios. Guarda: patrón `fecha_iso` en los dos trinquetes (14 sitios en pantalla y 7 frases del backend) y test del rótulo ET | `1aeb8f0` |
| — | (revisor A6) Los commits llevan `Co-Authored-By: Claude Opus 5.5`, y CLAUDE.md dice «sin identificadores de modelo en commits» | **decidido por Victor (2026-10-09)**: manda CLAUDE.md. Desde ese día los commits van sin identificador de modelo; los 147 anteriores no se reescriben (exigiría forzar `main`) | — |
| — | (revisor B6) Las bandas de tipo de cambio no ven una inversión cerca de la paridad (EUR del revés da 1,09 por dólar, dentro de 0,5–1,8; también GBP y CHF) | **para Victor**: estrecharlas es cambiar un umbral (§3). Propuesta: banda por divisa alrededor de su rango de 30 años | — |
| — | (revisor B5) Un instante sin zona: el backend lo escribe en UTC y el frontend en la hora del navegador | **hecho (27 oct)**: los dos gemelos escriben UTC, con hora rotulada y sin ella (`fmtFecha` usaba la zona del navegador y el mismo instante daba dos días distintos); la hora de un dato de mercado, en ET | — |
| — | (revisor B1) La guarda AST no ve un float crudo en un subíndice o una variable local (`f"{est['sharpe']}"`), ni ESLint un `${x}` con un float | **límite conocido**: los tipos no se ven sin ejecutar; lo cubren los trinquetes de fugas (`decimal_punto`) sobre el paquete de casos extremos |  — |

## Etiquetas

Las etiquetas nunca llegaron a GitHub: en el repositorio anterior el proxy cortaba su push, y en
este los permisos de la sesión tampoco dejan crearlas ni empujarlas sin una regla explícita. Hasta
que estén en el remoto, cada sesión las recrea desde la tabla de arriba (son las que necesita la
revisión de cierre, `git diff fase-N-inicio..HEAD`):

```bash
git tag fase-0-inicio de14316 && git tag fase-0-hecha 877428d && git tag fase-1-inicio 877428d
git tag fase-1-hecha f2c2af9 && git tag fase-2-inicio f2c2af9
git push origin 'refs/tags/fase-*:refs/tags/fase-*'   # cuando se pueda; después ya no hará falta
```

## Hallazgos fuera de la lista (para decidir en su fase)

- **`thesis_watch.evaluar_noticia` usa la hora real** (`datetime.now`) para la ventana de noticias, no el
  momento del análisis: un análisis a fecha pasada filtra las noticias de la tesis con la ventana de hoy.
  Posible fuga de «punto en el tiempo». Encontrado al montar el golden (que congela el reloj por esto).
  Tocarlo cambia decisiones del replay: requiere tu visto bueno. (Revisión del 9-oct: hoy es latente,
  porque el replay solo lee lo congelado y ningún camino con `ahora` pasado tiene tesis; y la raíz
  también está en el proveedor: `FinnhubProvider.get_news` pide `from/to` con `datetime.now`.)
- **El tipo de cambio de la cartera también usa la hora real** (encontrado por el revisor de la Fase 0).
  `contexto_cartera` llama a `_fx_completo` (`routers/portfolio.py`) sin pasarle el momento del
  análisis; `fx.inicio_de_ventana()` y `fx.tipo_desde_observaciones()` usan `date.today()` y no
  descartan observaciones posteriores. Un análisis a fecha pasada (o un replay) convierte con el tipo de
  hoy, un dato del futuro respecto a esa fecha. Misma familia que el anterior; mismo motivo para no
  tocarlo sin visto bueno.
- **Sin cotización, la ficha entera desaparece** (destapado al dejar de inventar datos en la demo).
  `TickerPage` trata la cotización como imprescindible: si falta, enseña «No se encontró el símbolo» y
  ninguna pestaña, aunque EDGAR tenga estados financieros, análisis, calidad e historial. Ausente ≠ «no
  existe». **Resuelto en 2.1**: cabecera, «Precio no disponible…» y todas las pestañas.
- **`?? 0` en el frontend** (`grep -rn "?? 0" frontend/src`): la mayoría solo eligen un color por el
  signo, pero alguno puede pintar un 0 donde falta el dato. En 1.7 se arreglaron los que pintaban una
  cifra (tasa de acierto, minutos de un precio viejo, alertas nuevas). La revisión del 9-oct contó 26
  líneas y no son solo de color y orden: «Posiciones 0» y «+0,0 %» en Cartera, la prima de opciones,
  «0 seguidas» en Señales y «0 ideas» en Hoy pintan una cifra si falta el campo; y `?? 0.05` en
  `ValuationSection` rellena un 5 % de crecimiento sin decirlo. **Resuelto en 2.1** (y «Cuánto de tu
  cartera» en Hoy, que enseñaba el peso bruto como final si faltaba este); quedan los `?.length ?? 0`
  de condición u orden, inocuos.
- **Un fallo se pinta como «vacío»**: índices y sectores del panel de mercado hacen `() => setX([])` al
  fallar (curva y macro ya se arreglaron en S11; el calendario en 1.10). El mismo patrón, también como
  `() => setX(null)`, está en unas 15 cargas más; la peor, las alertas de Portafolio («Sin alertas
  configuradas» si la carga falla, un control de riesgo que se calla), y después el efectivo de Cartera,
  `sinTesis` de Vigilancia, Screener, Resultados, Valoración, Señales, Multifactor y las secciones de la
  ficha. **Resuelto en 2.1**, con guarda de ESLint.
- **Las posiciones cerradas salen sin moneda**: con dos divisas, su P&L realizado sale sin código. La
  API ya manda `currency` y `opened_at` en cada cerrada (`routers/portfolio.py`); lo que falta es el
  tipo `ClosedPosition` del frontend y pasar la moneda a `<Pnl>` (también en «Realizado (cerradas)»).
  No cambia el contrato. **Resuelto en 2.1.** Queda en el backend: `mezcla_de_divisas` solo mira las
  abiertas (el frontend lo compensa); que `/api/portfolio` cuente también las cerradas.
- **El texto de la IA sale con el Markdown en crudo** («\*\*Lectura…\*\*»): `content_md` se pinta con
  `whitespace-pre-wrap`, sin interpretar. Visto en las capturas `con_ia` del ítem 1.3. Para 2.x (o
  pedir texto plano al modelo).
- **El golden congela `levels.objetivo` / `objetivo_pct`** y la pantalla Hoy lo muestra. Choca con
  «sin precios objetivo» (§3). No lo causa esta fase; si una fase lo retira, el golden cambiará y habrá
  que explicarlo.

- **Los sectores de las acciones salen en inglés** («Health Care», «Information Technology»): son los
  nombres GICS del universo, un dato y no un código, así que 1.8 no los tocó; los de un ETF (claves de
  yfinance) ya salen en español. Decidir en 2.x (glosario) si se traducen y con qué nombres.

## Revisión del 9-oct-2026 (tras la mudanza)

Siete lectores y un verificador por lector contrastaron README, PROGRESS, TODO y los documentos del
RC1 con el código. CI en verde (backend 1654 + 2 saltados por falta de grabaciones; frontend 160).
Lo que encontraron y adónde va:

| # | Hallazgo | Destino |
|---|---|---|
| M1 | Si falla la descarga de noticias, el disparador de noticias de la tesis cuenta 0 titulares como comprobados y la tesis sale «intacta» (UNKNOWN convertido en PASS) | hecho: `d86f3b8` (golden `tesis`, caso `vacios`, aprobado). Quedan hallazgos de su revisión, abajo |
| M2 | «Calibrada» sale con solo la probabilidad del modelo de factores, o con ventaja desconocida: Hoy dice «Reglas validadas contra el histórico» sin backtest de reglas | hecho: `c61a65d` (golden igual). Quedan hallazgos de su revisión, abajo |
| M3 | Hoy dimensiona sobre lo invertido aunque haya efectivo anotado (0008) y dice «la app no registra tu efectivo»; el coste de oportunidad sí lo usa | hecho: `88c391a` y, tras su revisión, `0a54bfd` (golden `hoy`: dos claves nuevas, ninguna cifra cambia) |
| M4 | La matriz de sensibilidad de la ficha pinta el valor total de la empresa como «valor/acción» si faltan las acciones (`valuation.py`, `value_per_share or equity_value`, hermano de P0-9) | 3.3 o antes |
| M5 | Hay tres DCF, no dos: el «precargado» del informe (`deep_dive._dcf_defaults`) aplica un 3 % supuesto sin decirlo y no lee la deuda parcial; la ficha supone un 5 % en el frontend y sube a 0 % un crecimiento negativo medido; con crecimiento negativo, bajista y alcista se invierten | 3.3 (incluir el tercero) |
| M6 | Opciones: volumen e interés abierto ausentes cuentan como 0 (`or 0`), sin marcar parcial | 2.1 o suelto |
| M7 | Las líneas de cron del README usan `/usr/bin/python3` (sin las dependencias del `.venv`: fallarían al importar) y dicen «horas en UTC» (cron usa la hora local) | corregir el README |
| M8 | README desfasado: sección «Tests» sin lint/Vitest/ruff, «ocho condiciones» del motor (faltan la banda de tendencia, resultados próximos, precio viejo, datos mínimos), yfinance como «solo respaldo» (es la única fuente de momentum, opciones, histórico largo y ETF), TTL del histórico (6 h, no 15 min), holdout fijo | 4.3 o antes |
| M9 | TODO.md sin tocar desde el 30-sep: casillas parcialmente hechas (ajuste por sector, eventos de noticias, riesgos cualitativos), errores (catalizadores sin eventos, tres juegos de WACC, migraciones 0001-0006) | actualizar con 4.3 |
| M10 | El backtest de reglas puntúa con un z-score global; Hoy, dentro de cada sector: el veredicto que enseña Hoy sale de otro sistema | para Victor |
| M11 | El parser de EDGAR no lee 40-F, IFRS ni CAD: las canadienses del universo no tienen «los mismos datos que una estadounidense» (sin comprobar con datos reales) | para Victor (`./start.sh validar`) |
| M12 | `requirements.txt` solo con `>=`, sin lock: la CI instala lo último en cada push; `anthropic>=0.60` se queda corto para lo que usa el proveedor (`fallbacks`, `output_format`, `thinking`) y un SDK viejo fallaría con un 500 | 4.5 o suelto |
| M13 | `ubuntu-latest` pasa a Ubuntu 26 el 19-oct-2026; las acciones `@v4/@v5` corren en Node 20, obsoleto | vigilar el CI |
| M14 | `frontend/tsconfig.node.tsbuildinfo` está versionado aunque `.gitignore` lo ignora; `tsc -b` lo reescribe (hoy idéntico) | `git rm --cached` cuando se toque |
| M15 | Informe de validación (`coherencia.py`): «1 periodos», fechas ISO y listas de Python en crudo; los trinquetes no lo ven | suelto |
| M16 | Altman Z cuenta como negativo en la lectura conjunta del informe también en bancos; el aviso solo está en Salud. ROIC con el 21 % supuesto entra en Multifactor y en disparadores sin aviso | para Victor |
| M17 | El instante de una decisión congela «0 disparadores saltando» sin guardar los no comprobados | hecho con M1 (`d86f3b8`) |

**Revisión independiente de M1–M3** (confirmada por un segundo agente). Arreglado en `05f6032`,
con un test por punto que falla sin el arreglo:

- M1: el análisis vigila el punto de noticias con la lista completa y su resumen (la misma que
  Vigilancia), no con los 10 titulares recortados para la pantalla.
- M1: unas noticias viejas rescatadas de la caché ya no cuentan como comprobadas: sin coincidencia,
  el punto queda «sin comprobar» con «copia guardada hace X»; con coincidencia, salta igual.
- M1: «Qué cambió» dice por qué un punto deja de medirse («ya no se puede medir (las noticias no se
  pudieron descargar)…») y `sin_comprobar` / `sin_puntos` tienen etiqueta.
- M2: el backtest que califica las reglas es el último fiable de la misma clase de activo; el pie de
  Hoy dice lo mismo que las filas (calibrada, refutada o sin validar y por qué); el panel de Señales
  no pinta en verde ni en rojo un backtest no fiable; una media sin operaciones de ese lado es «—».
  El golden de `decide` gana 6 casos (`reglas|…`: calibrada, refutada, gana menos que a ciegas, sin
  referencia, no fiable y solo probabilidad del modelo); solo se añaden, ninguno existente cambia.
- M3: los textos que decían «la app no lleva saldo en efectivo» (curva de la cartera y README)
  ahora dicen que el efectivo anotado no entra en la curva.

**Sigue abierto, para Victor** (M3): Hoy se cachea 6 h con la cartera y el efectivo de cuando se
puntuó. Invalidar la caché al anotar efectivo dejaba la ficha sin puntuación (la toma de esa lista) y
recalcular el tamaño al servirla contradice lo congelado. ¿Recalcular y congelar de nuevo al servir,
o basta con «Actualizar»?

**Revisión independiente del 2.1** (`d05312c`, 3 bloques revisados y cada hallazgo verificado por
otro agente; 16 confirmados o matizados). Arreglados en `c9eea22` y `d238798`:

- Ficha: un símbolo que no existe en ninguna fuente (los tres 404) vuelve a decir «No se encontró el
  símbolo» y no abre pestañas: «Qué cambió» congelaba una instantánea inmutable de él. Las pestañas
  esperan a saber que existe, y la pestaña elegida es del símbolo (un render con la anterior abierta
  ya pedía el análisis del nuevo).
- Un 404 en Fundamentales, pares, Salud, riesgo, Valoración, Filings y Opciones es ausencia, no
  «No se pudo cargar…» con un «Reintentar» inútil (el motivo de la fuente llega desde la segunda
  revisión, abajo).
- Recargar tras una acción (Portafolio, alertas, watchlist, efectivo, Expectativas, Tesis,
  Vigilancia) y las descargas de Cartera y Contribución ya no vacían la pantalla; el botón dice
  «Descargando…».
- Tesis: una lista que no carga ya no sale «Sin tesis guardadas» (el error iba dentro del formulario
  cerrado); el registro se pedía dos veces al montar. Vigilancia: su carga principal pasa por
  `useDato`. Borrar tesis, «+ Escenario» y «quitar» un punto ya no fallan en silencio.
- Noticias: un feed general tardío ya no pisa el del símbolo filtrado; «sin ANTHROPIC_API_KEY» ya no
  se afirma cuando solo falló la consulta del estado de la IA. La barra lateral vuelve a pedir ese
  estado cada 30 s, se entera del que consigue otra pantalla y dice «últimas cifras» a la vista.
- Dato viejo que parecía fresco: watchlist, índices y sectores de Mercado, y cada ETF del comparador
  (antes solo la insignia del primero).
- Hoy: la respuesta de un mercado que ya no es el elegido se descarta (su aviso tapaba la lista
  buena y su «Reintentar» cargaba el otro mercado).
- Tests: el de `useDato` que no podía fallar (ahora lo caza quitar el descarte de respuestas
  tardías), el «+0,0 %» de Cartera que no existía, seis guardas rotuladas como tales, y tests para
  las acciones rechazadas de Portafolio.

**Segunda revisión del 2.1** (`c9eea22`, 4 bloques y verificación de cada hallazgo; 13 confirmados o
matizados). Arreglados en `9b84525`, con tests que fallan con el código anterior salvo las guardas
rotuladas:

- VACIA (captura `empresa_sin_datos`) volvía a perder las pestañas: la ficha pregunta a EDGAR antes de
  decir «No se encontró» (`d238798`), y si un símbolo ya no está en ninguna fuente pero tiene decisiones
  congeladas, las enseña (el historial es la única entrada a sus replays).
- El freno a las instantáneas de símbolos inexistentes estaba solo en la ficha: un 502 en una pieza
  abría las pestañas, y «Coste de oportunidad» en Cartera congelaba cualquier símbolo escrito. Ahora
  lo frena el backend (`analisis_empresa.sin_ningun_dato`): sin cotización, perfil, fundamentales ni
  estados no se congela, y la respuesta dice por qué (`sin_congelar`; `docs/DECISION_REPLAY.md`).
- El 404 enseñaba «'financials' no existe en ninguna fuente (edgar)», un código en crudo, y el test se
  inventaba el motivo: el router compone ahora el 404 con lo que dijo cada fuente («edgar: SHOP.TO no
  está registrado en la SEC…») y los tests usan los textos reales.
- Opciones: un fallo a mitad (vencimientos sin contratos, sin precio de la acción) salía como «no
  cotiza opciones»; ahora es un fallo (502). Calidad e Informe separan 404 (EDGAR no lo tiene) de 502
  (no respondió) y su 404 ya se dice como ausencia.
- El recorrido de la cartera no se volvía a pedir tras añadir o cerrar una posición (y el test lo
  exigía): vuelve a pedirse, sin vaciarse. `refrescar()` desde un error vuelve a «cargando» (en Cartera
  dejaba el error con «Reintentar» durante la descarga y permitía lanzar dos). Lo que se refresca se ve
  atenuado, con «Actualizando…», y no se puede pulsar (una tesis ya borrada seguía con su «Borrar»).
- StrictMode (`npm run dev`, el modo de uso): `useDato` y Hoy reutilizan la petición en curso; antes
  cada carga llegaba dos veces al backend, y Hoy lanzaba dos cadenas de pasadas (doble cuota). Hoy
  descarta por petición, no por mercado (S&P 500 → Canadá → S&P 500), y al volver a un símbolo la
  ficha ya no reabre «Qué cambió».
- Entradas de usuario: «+ Escenario» acepta «bajista/base/alcista», lee «12,5» y «1.250» con la
  convención de la app y dice lo que no entiende (antes 12 y 1,25 sin aviso, o nada); un umbral vacío
  ya no se guarda como 0 %. Borrar algo que ya no existía (404) no es un fallo.
- Textos: «IA apagada» (no «off»), las pestañas del formulario de disparador con `etiqueta()`, el
  fallo de red en español, y en Mercado «ninguna fuente dio precio» (no afirma una caída).
- Tests: el de `useDato` que comprobaba un «cargando» del reintento y no del cambio de clave, y los
  rótulos de guarda que faltaban (Informe 502, acciones rechazadas de Portafolio). Mutaciones de
  `useDato` (devolver la carga de otra clave, quitar el descarte, conservar un error, no reutilizar
  la petición): las cuatro las caza algún test.

**Tercera pasada** (`9b84525`, 3 bloques y verificación; 12 confirmados o matizados, varios en los
arreglos de la segunda). Arreglados en el commit «fix(2.1): tercera pasada…»:

- `useDato` guardaba para siempre la promesa reutilizada en StrictMode: /ticker/AAPL → /ticker →
  /ticker/AAPL enseñaba el precio de la primera visita como actual. Ahora solo reutiliza la que está
  en vuelo. `BloqueDatos` remonta su contenido al empezar y al acabar un refresco; tener el envoltorio
  siempre (`display: contents`) lo evitaba, pero quitaba los márgenes de `space-y-*` en 20 pantallas
  (lo destapó repetir las capturas), así que se acepta el remontaje y se quita su coste concreto:
  `CompanyLogo` recuerda los logos que fallaron y no los vuelve a pedir.
- La consulta de las decisiones guardadas de un símbolo no encontrado, si falla, se dice con
  «Reintentar».
- Cifras escritas a mano: `leerNumero` leía «0.125» como 125 (un grupo de miles no empieza por 0) y no
  aceptaba «.5»; Vigilancia ya no lo usa (su campo es numérico y el navegador lo normaliza: un umbral
  de tres decimales se multiplicaba por mil). Y llega a lo que guarda datos del usuario, que seguía con
  `parseFloat`: posición, stop, venta, alerta, efectivo y tipo impositivo («1.250,50» era 1,25 y
  «10.000» de efectivo eran 10). Lo que no se entiende se dice y no se envía.
- Backend: `sin_ningun_dato` decide con el análisis (sin volver a preguntar: en una caída eran ~20
  llamadas con esperas) y distingue «ninguna fuente lo tiene» de «no respondieron»;
  `./start.sh validar` contaba como TypeError un símbolo sin congelar (ahora UNKNOWN); una cadena de
  opciones sin precio se cacheaba una hora (ahora el validador la rechaza y un fallo no se cachea);
  el «not found» de Twelve Data llegaba en inglés a la pantalla.

Pendiente (baja, no regresión): un 429 de yfinance en la cadena de opciones se reintenta como
cualquier `ProviderError` (+2 peticiones); traducir los 429 de yfinance a `RateLimitError` sería una
mejora general. Los campos del DCF de la ficha (`ValuationSection`) siguen con `parseFloat`: no se
guardan, pero leerían «12,5» como 12.

Queda para la fase 4.5: `@typescript-eslint/no-misused-promises` marca 29 manejadores `async` en
13 ficheros (la mayoría capturan dentro); activarla es revisarlos uno a uno. Tampoco se ve una
referencia a función que se trague el error (`.catch(ignorar)`): sin tipos no se distingue de
`.catch(setError)`.

**Notas de la migración del 2.1** (fuera de su alcance): `routers/options.py` aplana la cadena y tira
`estado`/`antiguedad_segundos` (una cadena vieja sale como normal); `CalidadSection` y `OptionsSection`
pintan códigos en mayúsculas sin `etiqueta()` (`BUENO`, `CONTANGO`…); Multifactor no enseña
`sin_puntuar`; el `DailyPrice` del frontend no declara `estado` (Hoy no dice «dato viejo» en la fila);
un replay pedido para un símbolo puede llegar tras cambiar de símbolo.

## Auditoría del 19-oct-2026 (sobre `main` d28a058)

Una auditoría externa con siete hallazgos; todos seguían en esta rama. Se arreglan en orden de
prioridad, cada uno con un test que falla con el código anterior.

| # | Hallazgo | Estado |
|---|---|---|
| A1 (P1) | El stop de la posición se redondeaba a dos decimales ANTES de compararlo: coste 0,005, stop 0,004 y precio 0,003 salía «mantener» (la regla preguntaba «0,003 ≤ 0»), con el stop a «−100 %» | hecho (abajo) |
| A2 (P1) | `oportunidad.efectivo_usd` convertía con el último tipo de la serie, aunque fuera posterior a la fecha de la decisión | hecho (abajo) |
| A3 (P2) | Una posición en peniques (GBX, ZAC, ILA) tumbaba `/api/portfolio` con un 500 | hecho (abajo) |
| A4 (P2) | Un efectivo anotado hoy con fecha atrasada aparecía en reconstrucciones de antes de anotarlo | hecho (abajo) |
| A5 (P2) | Una instantánea congelada posterior a la fecha pedida escondía la anterior válida | hecho (abajo) |
| A6 (P2) | El backend aceptaba cualquier cabecera `Host` | hecho (abajo) |
| A7 (P2) | En móvil la barra lateral fija se come la pantalla (es el 2.12) | hecho (abajo) |

**A1.** Se compara con el valor sin redondear (el stop guardado tal cual, el recalculado sin
`round`) y solo se redondea lo que se sirve, con `datos.redondear_precio`: dos decimales desde 1 (el
tick de siempre; las cifras de las acciones normales no cambian y el golden queda idéntico) y cuatro
cifras significativas por debajo. Lo mismo en los otros sitios que perdían la cifra: Yahoo servía el
último cierre con `round(x, 2)` (0,003 era 0 y el motor decía «sin precio»), los niveles de compra
(entrada 0,00–0,00, stop 0,00), el stop fijado al abrir (`round(…, 4)`: 0,00005 se guardaba como 0,
es decir «sin stop»), la cartera (`round(…, 2)` del stop) y las operaciones del backtest. Para
pintarlos, `fmt_precio`/`fmtPrecio` (gemelos, 18 casos en la tabla compartida) en Hoy, la ficha, la
cartera, tesis, vigilancia, historial y el gráfico. Hermano: un stop guardado con tres decimales
(92,004) también se redondeaba y un precio de 92,002 salía «mantener». Guardas: el caso de la
auditoría (vender, stop 0,004, distancia +33,3 %, disparador «0,004»), niveles positivos y ordenados
de 1e-8 a 1e5, stop recalculado bajo el coste, Yahoo, el stop guardado por la API y el render de Hoy
(9 de los 18 tests del backend y el de Hoy fallan con el código anterior; el resto son guardas de no
regresión para precios normales).

**A2.** El tipo es el último que ya se conocía en la fecha de la decisión (`pit.filtrar`; el del
mismo día de una decisión con hora no, salvo prueba), y viaja en el detalle con su fecha
(`tipo_por_usd`, `tipo_fecha`, `tipo_fresco`). Se distinguen los tres casos: ningún tipo
conocido a esa fecha (desconocido, con su motivo), uno de más de `fx.DIAS_FRESCO` días (se
convierte, estado `viejo`, y la nota de Hoy dice la fecha del tipo) y uno reciente. Nuevo
`pit.antiguedad_dias` para no restar fechas a mano. El test de la ficha con efectivo en CAD
usaba el reloj real con una serie anclada a `AHORA`: ahora usa `AHORA` (con el reloj real el
tipo tenía semanas, y eso ya se dice). Guardas: el caso de la auditoría (100 USD, no 86,67),
el tipo del mismo día, la serie que empieza después y el tipo viejo (fallan con el código
anterior); el tipo reciente sin aviso es guarda.

**A3.** El `fx.normalizar` suelto que reunía las monedas lanzaba `SinTipo` antes de llegar a
`convertir_cartera`, que ya sabía dejar la fila visible, fuera del total y con su motivo; ahora
pasa por `_moneda_segura`. Barrido: todas las rutas GET de la cartera con una posición en GBX
(solo `/api/portfolio` caía). Hermano: el contexto de cartera (ficha, riesgo, coste de
oportunidad) decía «moneda desconocida» de una moneda que se sabe en peniques; ahora da el
motivo real. Guardas: la cartera con GBX y USD (200, total solo con USD, ninguna serie de FRED
pedida) y el motivo del contexto (fallan con el código anterior).

**A4.** Una anotación cuenta en `ahora` solo si su saldo está fechado antes **y** se anotó antes
(`registrado_en`), las dos con `disponible_en(...) is True`: antes bastaba la fecha del saldo y
lo que no se podía probar (`None`) contaba como sabido. Vigencia definida: entre las que
cuentan manda el saldo más reciente (`as_of`), no la última fila; con el mismo `as_of`, la
anotada después corrige. Hermano: `GET /api/portfolio/efectivo` enseñaba la última fila
(`max(id)`), así que un saldo antiguo anotado después salía en pantalla como el de hoy mientras
los cálculos usaban otro; ahora usa la misma función. Las tres fixtures que modelan «anotado el
día de su saldo» (extremos, `test_e2e_evolucion`, coste de oportunidad) lo declaran en
`registrado_en`: con el reloj real quedaban anotadas después de su propio `ahora`. Golden igual.
Guardas: anotada con fecha atrasada, saldo antiguo anotado después, corrección del mismo día y
la pantalla coherente (los cuatro fallan con el código anterior).

**A5.** `_lectura_congelada` filtra por `disponible_en(creado_en, ahora) is True` antes de
coger la más reciente, como ya hacía `anterior_comparable`. Barrido de las otras consultas «la
más reciente» de instantáneas: `anterior_comparable` ya filtraba antes; el historial de la ficha
lista todas y el antiduplicado de `congelar_analisis` es del momento presente. Guarda: dos
lecturas reales (`analizar_y_congelar`) a dos fechas; la del medio ve la primera (falla con el
código anterior), después ve la segunda y antes de las dos, ninguna.

**A6.** `HostDeConfianza` en `main.py`, la más externa: una cabecera `Host` que no es de esta
máquina (`settings.allowed_hosts`, por defecto `localhost`, `127.0.0.1`, `[::1]`; `ALLOWED_HOSTS`
en `.env`) es un 400 con el motivo en `detail`, en español, antes de llegar a ninguna ruta. No es
el `TrustedHostMiddleware` de Starlette porque responde en inglés y en texto plano y su lector
de la cabecera es privado (`starlette._utils`); este compara sin distinguir mayúsculas. Los
tests añaden `testserver` en `conftest.py` (solo ahí); el golden y el exportador de fixtures,
que corren fuera de pytest, llaman con `base_url="http://localhost"`. Guardas: seis hosts ajenos
(dominio, con puerto, IP de la red, sufijo engañoso, vacío, `::1` sin corchetes) son 400 sin
llamar a ningún proveedor, cinco de esta máquina pasan y el valor por defecto no incluye
`testserver` (los siete primeros fallan con el código anterior). Golden y fixtures idénticos.

**A7 (ítem 2.12).** `Layout.tsx`: por debajo de `md` (768 px) una barra superior con el logo y
«Menú», que abre la navegación como cajón; se cierra al navegar (también a la misma pantalla),
con Escape (el foco vuelve a «Menú») y tocando fuera; desde `md`, la barra lateral de siempre.
Relleno del contenido 16 px en móvil (24 desde `md`). El criterio del plan se convirtió en guarda
de `npm run capturas`: a 390 px una pantalla falla si desborda en horizontal (dice qué elemento
lo empuja; lo que está dentro de un contenedor con scroll propio no cuenta) o si un texto de tres
o más palabras sale con una palabra por línea; y el clic de las acciones ya no es `force`. Con el
cajón, lo que quedaba: la leyenda del gráfico (32 px fuera; ahora `flex-wrap`), los selectores
de mercado y de vista de Hoy («Mejores ideas (5)» en tres líneas; ahora se desplazan en su marco
sin partir las etiquetas) y la cabecera de la tabla de Calidad («Días de cobro»). Dos capturas
nuevas, solo a 390: el menú abierto y la navegación desde él, con clics reales. Hermano,
regresión de A1: el `priceFormatter` global del gráfico con `fmtPrecio` formateaba también RSI y
MACD (valores bajo 1 con cuatro decimales), el eje se ensanchaba y el gráfico se desplazaba; ahora
cada serie lleva su formato (las de precio `fmtPrecio`, con el paso que dan sus decimales) y no
hay formateador global, que mandaba sobre el de cada serie (segunda revisión, abajo). Capturas: 68 sin fallos; a 1440, 24 idénticas y el resto con diferencias de antialiasing
salvo Calidad (relleno de columnas). Guardas: 5 tests del cajón en `Layout.test.tsx` (fallan con
el código anterior) y las dos guardas de las capturas. Queda como estaba el aviso de Vite por el
tamaño del paquete (~717 kB): es el 2.14 (rendimiento).

### Revisión del 2.12 y de A1–A6 (workflow, 23 oct)

Dos pistas en paralelo: las 35 capturas a 390 px, con un verificador por hallazgo (44
confirmados, muchos repetidos entre pantallas; 32 refutados como estéticos), y una revisión
adversarial del código de A1–A6 (abajo, cuando se verifique).

**Visual, arreglado.** La herramienta de capturas: a 390 px una página de más de 4000 px salía
recortada a la primera pantalla (`clip` sin `fullPage`), y tras pulsar un botón la cabecera fija
se pintaba a media página. Tablas que se apretaban o escondían columnas (Historial, Calibración
de expectativas, Características de la cartera, Calidad, Fundamentales, comparador de ETFs):
`lib/tablas.ts` (`TABLA_COMPACTA`, `COLUMNA_FIJA`) y `<MarcoTabla>`, una sola forma de hacerlo; en
Fundamentales y ETFs, sin `min-w` y con el rótulo fijo, de modo que las cifras se ven o asoman.
Rótulo y motivo pegados en «Valoración frente a su propia historia» («P/ESolo…»); fecha ISO en
Catalizadores (`fmtFecha`); la hora del Historial sin zona junto a un origen en UTC; los
selectores de Hoy saltan de línea en vez de recortar la opción activa; el «·» huérfano en «Lo que
NO comprar»; el «quitar» de Vigilancia tapaba el detalle (ahora va en el flujo); el porcentaje
del P&L de Portafolio se salía de su tarjeta; el botón de IA de Noticias dejaba media tarjeta al
titular; «Qué cambió» sin espacio antes de «(umbrales…)» y con el hash entero, valores que
perdían la alineación al bajar de línea y el botón de IA activo con el resumen ya a la vista
(cada toque gastaba API); los KPI de concentración en dos columnas; contraste de los títulos
del menú (1,9:1 → `slate-400`) y el significado del tachado de la barra de APIs a la vista; el
marcador de las filas desplegables de Calidad; la cabecera móvil centrada. Espacio duro: 18
literales del backend con «15 %» y espacio normal (en móvil, «15» / «% de crecimiento»), con
guarda AST en `test_formato.py`; el único exento, la etiqueta que entra en el hash de los
umbrales de «Qué cambió» (otro espacio sería otra versión). «ratio corriente ≥ 1.2» con punto
decimal en los presets del screener; «Desempleo EE. UU.» sin partir.

**Hermano serio, arreglado.** El formulario de Vigilancia lo pedía todo en % y dividía entre 100:
«ratio corriente < 1» se guardaba como 0,01 y el punto no saltaba nunca, un control de riesgo
desactivado en silencio. El catálogo dice ahora la `unidad` de cada métrica (`pct` o `veces`), el
formulario y la serie de la tarjeta la usan, el detalle sale en la unidad («21,0 % … 18,0 %», no
«0,210 … 0,180») y los puntos viejos en `veces` se leen de las dos formas (tercera revisión,
abajo). Dos tests ajustados a la cifra
nueva (`test_gramatica`, `test_thesis_watch`: la frase es la misma); el de opciones busca el «%»
con espacio duro. El recorte «Ideas nuevas al 0 %» se reconoce por una constante
(`sizing.RECORTE_SIN_HUECO_DE_RIESGO`) y no buscando el texto «0 %» suelto. Golden idéntico.

**Código, A1 (tres votos a favor), arreglado.** (1) Fail-unsafe: con el stop ya entero, Yahoo seguía
sirviendo el último cierre redondeado a dos decimales; un stop de 1,8165 con el cierre en 1,8155
se comparaba con 1,82 y salía «mantener». Ahora `_price_summary` sirve el cierre tal cual (la
pantalla lo escribe con `fmtPrecio`). (2) La traza de «¿Por qué?» y «¿Qué la cambiaría?» pintaba
los precios con `fmtNum(v, 2)`: el caso de la auditoría se leía «0,00 frente a 0,00»; ahora las
reglas de precio usan `fmtPrecio`. (3) Lo servido y lo escrito no coincidían en los empates de
medio céntimo (`round()` frente al formateador: stop 2,67 en la tarjeta, «2,68» en el disparador):
los textos escriben ahora el valor servido. Hacerlo al revés —servir con el redondeo del
formateador— cambiaba `decide` y `hoy` del golden, y eso es de Victor. (4) Los mensajes de stop
de la cartera («No se puede bajar el stop de 0 a 0») y (5) su minigráfico (32 ceros, plano y en
verde). (6) Las medias de `/history` a 4 decimales fijos (0 o el doble del precio por debajo de
0,0001). Golden idéntico; guardas en `test_precision_precios.py`, `DecisionExplicada.test.tsx`
(todas fallan con el código anterior).

**Segunda revisión (de `ea20bc9` y `eda2424`, verificada).** (1) Regresión de A7: el
`priceFormatter` global de lightweight-charts manda sobre el `priceFormat` de cada serie, así que
con `fmtNum(p, 2)` una acción de 0,003 volvía a tener todo el eje en «0,00»; se quita el global y
cada serie lleva el suyo (RSI a dos decimales, MACD como el precio si es menor que 1). (2) El
umbral sospechoso solo avisaba, y el punto seguía contando como «no cruzado»: la tesis salía
intacta con un control que el código sabía roto. Ahora queda sin comprobar (`medible: False`,
como un dato que falta) y dice qué haría («no saltaría nunca» o «saltaría siempre»); cero y
negativos siguen siendo umbrales legítimos (exento del golden por eso; el caso nuevo del golden,
para Victor). (3) El cajón: tocar el velo no devolvía el foco a «Menú», y abierto no era modal
(Mayús+Tab salía a la cabecera tapada); ahora la cabecera y el contenido quedan `inert` y el cajón
es un diálogo. (4) La lista de Hoy entre 768 y 1280 px apretaba el nombre hasta una letra por
línea: las barras de factores se ven desde `xl` y, debajo, al desplegar la fila; captura nueva a
820 × 1180 y vista «Todas» con sus guardas. (5) `fmtFecha` con hora y sin zona escribía la hora
local del navegador sin rótulo («16:35» en «Qué cambió» y «14:35 UTC» en el Historial para la
misma instantánea): ahora UTC rotulada, como el gemelo (caso nuevo en `formato.casos.json`); las
horas de las noticias, en ET. (6) Los KPI de Fundamentales a 390 px, en dos columnas. (7) Espacio
duro en los literales del frontend («IC 95 %», «0 %», «100 %»), con regla de ESLint. (8) Las
capturas fallan también si un contenedor con `overflow-x: hidden` recorta texto, y la guarda de
«palabra por línea» cuenta líneas de verdad (rectángulos del texto) y no parte por el espacio
duro. (9) Las tablas con scroll eran un `div` sin foco: con teclado no se llegaba a las columnas
de fuera; `<MarcoTabla>` (región con nombre, `tabIndex=0` y anillo de foco) es ahora la única
forma, en las 17 tablas, con guarda en `MarcoTabla.test.tsx`. Golden idéntico.

**Visual, no se toca (registrado).** El texto de la IA se pinta con el Markdown sin interpretar
(`BloqueIA`; los prompts piden Markdown): pide un renderizador seguro o texto plano, fuera del
2.12. Las 11 pestañas de la ficha en 5 filas en móvil: es el 2.6 (6 + «Más ▾»). En el gráfico,
el primer rótulo del eje de tiempo cortado y los rótulos de 70/30 del RSI sobre los ticks.

### Hermanos de A1–A6 (verificados, 23 oct)

De la revisión adversarial del código de A1–A6, los hallazgos con dos o tres votos a favor.

**A4.** Desde que manda el `as_of` más reciente, un saldo enviado solo con el día
(«2026-10-20») se guardaba como su medianoche y perdía siempre contra uno con hora anotado
antes ese día: el POST respondía 200 y seguían mandando los 10.000 de la mañana, el lado no
prudente. Un día suelto se lee como día (hoy, la hora del registro; uno pasado, su último
instante), un `as_of` unos minutos adelantado se recorta a ahora (la pantalla decía «Sin
efectivo anotado» esos minutos) y el POST dice si la anotación queda `vigente`.

**A3.** (1) yfinance da «GBp» para Londres y tres sitios lo pasaban a mayúsculas: «GBP», y la
posición se convertía como libras, cien veces su valor. Una sola lectura, `fx.codigo`, para la
cotización, el perfil y el instrumento. (2) Una fila en peniques no contaba como otra divisa:
la nota decía «Toda la cartera está en USD» y Riesgo, «moneda desconocida». (3) Dos lotes en
peniques del mismo símbolo: el primero salía dos veces y el segundo no se podía cerrar (las
filas sin convertir se reponían por símbolo; ahora por id). (4) La curva y las cerradas
también decían «moneda desconocida»; el aviso de la curva decía «por no tener histórico» de
cualquier excluida, y ahora dice el motivo de cada una. (5) El motivo pedía «Corrige la divisa
de la posición», que la app no permite: ahora dice que viene del proveedor y queda fuera.

**A2 y A5, en la cartera del contexto.** `contexto_cartera.construir`, reconstruido a una fecha:
(1) filtraba en SQL por `closed_at IS NULL`, y una posición abierta ese día y cerrada después
faltaba del capital y de los comparables mientras el mismo análisis la daba por abierta; (2)
pesaba cada posición con la cotización de hoy (ahora, el último cierre conocido entonces,
«viejo»); (3) convertía con el último tipo de la serie mientras el efectivo usaba el de
entonces: dos tipos para el mismo CAD en el mismo capital. **Encontrado de paso, en vivo:** una
cotización o unos fundamentales descargados durante el análisis llevan la hora de la descarga,
milisegundos después del `ahora` con que empezó, y `seccion_mercado` los tiraba como
«posteriores» (precio fresco de yfinance → se decidía con el cierre de ayer, «viejo»; los pares
sin señal). `pit.descargado_a_tiempo` les da un margen de 5 minutos (`MARGEN_DE_DESCARGA`); a una
reconstrucción del pasado no le cambia nada. Golden idéntico.

**A4, en otras tablas.** Los puntos de una tesis se cargaban sin mirar su `created_at` (y añadir
uno no toca `updated_at`): uno añadido el 15 de octubre cruzaba en la reconstrucción del 12 una
tesis que entonces no tenía puntos; y `resumen_para_analisis` filtraba los resultados para
saber si el evento estaba resuelto pero luego `evaluar` releía todo (el guidance anotado
después, las expectativas del evento siguiente). Ahora todo pasa por la fecha de registro.
Los dobles de los tests creaban los puntos con el reloj real y analizaban el 12 de septiembre:
se les da la fecha de su tesis. **Queda, para Victor:** un punto **borrado** después no se
puede reconstruir (no queda rastro de la baja); guardarla pide una migración (`borrado_en`).

**A6.** (1) El filtro de `Host` cerraba el DNS rebinding, pero no las peticiones simples de otra
web: con `Host: 127.0.0.1:8000`, el de verdad, un `<img>` hacia `/api/empresa/AAPL/analisis`
congelaba una instantánea inmutable y un POST sin cuerpo gastaba cuota (CORS solo impide leer
la respuesta). El mismo middleware rechaza con 403 un `Origin` que no es la interfaz ni el propio
backend, y sin `Origin`, un `Sec-Fetch-Site` de otro sitio. Las capturas sirven la interfaz en
otro puerto y se lo dicen al backend de demostración (`CORS_ORIGINS`). (2) `ALLOWED_HOSTS`
sustituía la lista y con `["mi-mac.local"]` el proxy de Vite (que llama como `localhost`)
recibía un 400 en todo; ahora se añade a los nombres de esta máquina. (3) `start.sh` decía
«Todo listo» con el backend respondiendo 400 (`curl -s`); ahora `curl -sf`.

**A1, los hermanos.** (1) Los umbrales de tendencia salían ya redondeados de `_umbral_entrar`
y `_umbral_salir`, y con ellos se medía la distancia: con la media en 1,0054 el umbral exacto es
1,0255 y el servido 1,03, así que «Qué la cambiaría» pedía «precio ≥ 1,03» con 1,0256, una
condición ya cumplida. Ahora se calcula con el exacto y solo se sirve redondeado. (2) Textos de
precio con decimales fijos: el motivo de una alerta («a 0,00, por debajo de 0,00»), el prompt
del análisis IA («Precio actual: 0,00»), el intervalo de comparables («da 0–0, y cotiza a 0»,
y servido con `round(x, 2)`), el rango de Valoración y su nota. Todos con `fmt_precio`. Golden
idéntico.

**A2 y A5, los últimos.** (1) El estado «viejo» del efectivo y el motivo «sin tipo de cambio a
esa fecha» se quedaban en `coste_oportunidad.efectivo`, que ninguna pantalla lee: la ficha daba
«Hay efectivo… no hace falta vender nada» con un tipo de hace tres semanas, y pedía «Anota tu
efectivo» con el efectivo anotado. El motor recibe `aviso_efectivo` y lo dice en el veredicto.
(2) El antiduplicado de `congelar_analisis` miraba la instantánea más reciente aunque fuera
posterior a `ahora`: con una del día siguiente en la base, cada análisis igual congelaba una
copia inmutable. Filtra como `_lectura_congelada`. **Queda, para Victor:** los lotes de posición
no guardan cuándo se anotaron (`opened_at` lo escribe el usuario), así que uno anotado hoy con
fecha atrasada entra en una reconstrucción anterior. Arreglarlo pide una columna
`registrado_en` en `positions` (migración) y decidir qué hacer con las filas viejas, sin fecha
de registro: exigirla como al efectivo las sacaría también del análisis de hoy. Golden idéntico.

### Tercera revisión (de los hermanos de A1–A6, workflow, 27 oct)

Once revisores sobre los commits de la segunda revisión y de los hermanos, y tres lentes por
hallazgo (corrección, reproducción, impacto): 34 con dos o más votos, 1 descartado.

**El margen de descarga, una sola regla.** Lo introdujo `2f8d84b` solo en el análisis: al
congelar, la cotización aceptada con margen quedaba como «futura» y el replay retiraba el precio
con que se había decidido (completo=False, FAIL en `./start.sh validar`), en cada análisis en vivo
con cotización de yfinance o Twelve Data. Ahora `anomalias_temporales` aplica
`descargado_a_tiempo` a la cotización y a la puntuación de pares, y el desempate por `obtenido_en`
lleva el mismo margen (la barra o el filing de hoy descargados durante el análisis entraban solo
si venían de la caché). En `construir`, las cotizaciones se piden antes que el histórico largo,
sin cotización hoy se usa el cierre de entonces, el motivo dice cuándo la cotización es
posterior, y `_tipo_en` pasa el detector de inversión (un último punto de 13 en vez de 1,30
convertía a 10 USD sin aviso).

**Los puntos viejos en «veces», sin corte por valor.** El de la segunda revisión (≤ 0,1 → sin
comprobar) tenía tres fallos: un punto cruzado con las dos lecturas («cobertura < 10» guardado
como 0,1, con EBIT negativo) pasaba de CRUZADO a «sin medir», fail-unsafe; un umbral nuevo y
legítimo («Deuda/capital > 0,1») quedaba sin comprobar para siempre; y uno viejo de 0,15
seguía «no cruzado». Ahora los puntos nuevos guardan `unidad` al crearse, y uno viejo en `veces`
con el umbral por debajo de 1 (`LEGADO_MAX`, desde la cuarta revisión `TOPE_LEGADO` por métrica) se lee tal cual y ×100: si coinciden, ese es el
veredicto; si no, sin comprobar con lo que daría cada una. La nota de la tesis ya no atribuye
todo lo no comprobado a «falta de datos». Golden idéntico (su `D/E > 2` se lee tal cual).

**La tendencia de A1, hasta el final.** El «umbral exacto» de `9bebc3d` no llegaba a producción:
`_price_summary` servía la media de 200 sesiones redondeada (1,0054 → 1,01), y con ella decidía
el motor; ahora el motor recibe la entera y la ficha la sirve redondeada (golden idéntico). Una
condición a menos de 0,005 % del umbral se daba por cumplida (distancia redondeada a 0,0) y
«→ Comprar si:» quedaba vacío: ahora se decide con la misma comparación que la regla. «Vigilar»
decía «cotiza bajo su media» dentro de la banda, encima de ella, y pedía cerrar sobre la media sin
la banda; «mantener» decía «precio sobre su media» sin media. Los rangos del DCF, redondeados a
tres cifras significativas a propósito, salían con céntimos («147,00»): `fmt_valor_redondo`, gemelo
nuevo («147», «0,00347»). «Qué cambió» escribe los precios con `fmtPrecio`.

**Efectivo, peniques, origen y tesis.** (1) El antiduplicado filtraba por «ya existía en `ahora`»
y dos análisis solapados (el que empezó después congela antes) dejaban dos instantáneas
iguales; ahora compara con la última del mismo día. (2) «No cabe» con efectivo de tipo viejo no
lo avisaba; Hoy, con el efectivo anotado y sin tipo, pedía «Puedes anotarlo» y perdía el motivo.
(3) El «hoy» de un saldo solo con el día es el UTC; el de mañana en UTC (el hoy de quien está al
este) cuenta como hoy, y los mensajes lo dicen. (4) La fecha de apertura unos minutos adelantada
se recorta a ahora, como el efectivo. (5) Migración **0009**: vacía la moneda «GBP» que el código
anterior guardaba por «GBp»; con ella, una cerrada o una cotización sin moneda convertían
peniques como libras. (6) Con toda la cartera en peniques, Riesgo y la curva dicen el motivo
real. (7) El origen: `Sec-Fetch-Site: same-origin` pasa (la interfaz en otro puerto recibía 403
en todo POST), sin Fetch Metadata se mira el `Referer`, y el 403 dice cómo arreglarlo
(`CORS_ORIGINS`). (8) La ventana de noticias de la tesis acaba en el `ahora` del análisis, no en
el reloj de la máquina. (9) Test del filtro de puntos de `evaluar(…, ahora)`, que nada cubría.

**Frontend.** (1) El cajón abierto al pasar a ≥ md (girar el móvil) dejaba todo inerte sin
salida visible: se cierra al cruzar el punto de corte. (2) Pulsar la pantalla en la que ya estás,
o «Atrás», dejaba el foco en BODY: vuelve a «Menú». (3) `fmtFecha` sin hora usaba la zona del
navegador: ahora UTC, como el gemelo (caso nuevo y un test con otra zona). (4) El anillo de foco de
`MarcoTabla` se pinta por dentro (lo recortaba el `overflow-hidden` del ranking multifactor); el
mensaje del error también va en `MarcoTabla`, y la guarda mira los `.ts` y cualquier scroll
horizontal. (5) La guarda de «palabra por línea» ya no salta un elemento con un icono o un hijo
oculto. (6) La regla de ESLint del espacio duro ve también una cifra y su «%» separados por un
salto de línea. (7) En Hoy por debajo de 640 px, el puesto global va junto al símbolo. Capturas:
104 sin fallos.

### Cuarta revisión (de la tercera, workflow, 27 oct)

Revisores sobre `d790aa9`…`21a0b8b` y un barrido de hermanos, con las tres lentes: 22
confirmados, ninguno descartado. Cada arreglo lleva un test que falla sin él; golden idéntico.

**Lo alto.** (1) «Capturar expectativas» daba 500 con la caché fría: el calendario de Finnhub se
descarga durante la captura, llega fechado segundos después de `ahora` y `_guardar` comparaba sin
margen. Ahora `descargado_a_tiempo` e `informacion_hasta` como mucho `ahora`; fuera del margen, 422.
(2) En vivo, una posición sin cotización entraba en los pesos con el último cierre de la caché
(total 3000 frente a los 1000 de `/api/portfolio`): ese respaldo queda para las reconstrucciones.

**FX.** Un punto suelto fuera de banda convertía la serie de la candidata (volatilidad cien veces
mayor), la curva de valor y el P&L realizado: `fx.puntos_en_banda` lo trata como un día sin
publicar. El tipo de la fecha de la decisión sigue rechazándose con su motivo.

**Tesis.** La lectura ×100 de un punto sin `unidad` solo si cabe en la métrica (`TOPE_LEGADO`:
10 veces en D/E y ratio corriente, 30 en cobertura; antes un «D/E > 0,5» se leía también como 50 y
un CRUZADO quedaba sin comprobar); ×100 redondeado (0,07 × 100 ≠ 7 en coma flotante); el motivo y el
detalle con el umbral entero (0,005, no «0,01») y sin afirmar «anterior al arreglo»; con las dos
lecturas iguales, un aviso; la nota ya no dice «no se ha cruzado» de lo no comprobado; la exención
del inventario del golden decía que lo cubría el golden y lo cubre `test_thesis_watch`.

**Decisión y textos.** Los umbrales de la banda se sirven y se escriben hacia el lado en que la
frase es cierta (`redondear_precio(..., hacia=...)`: entrada hacia arriba, reducir hacia abajo);
el disparador con posición dice «Reducir si cierra en o por debajo de X (media 200 − 1 %)»; «Qué
cambió» escribe los precios con `fmt_precio` y el resultado con `etiqueta()`; un test pasa por
`seccion_mercado` (media entera al motor, redondeada a la ficha); el backtest de reglas entra con la
banda del motor y lo anota (`banda_tendencia_pct`); README y el estado vacío de Hoy nombran la banda.

**Instantáneas, fechas y origen.** El antiduplicado compara con la última congelada (`id`): una del
mismo día a una hora posterior y otra huella volvía a duplicar. La fecha de apertura de mañana en
UTC cuenta como hoy, como el efectivo. `.env.example` y el README ya no prometen «cualquier puerto»
con un nombre de `ALLOWED_HOSTS` por http (un test lo fija).

**Frontend.** Valores por acción con `fmtPrecio` (BPA del replay, DCF, valor estimado de las
tesis; la matriz con `fmtValorRedondo`), `fmtMetrica` compartido por el replay y «Qué cambió», y
ESLint contra `fmtNum` sobre un valor por acción. El anillo de `MarcoTabla` es una capa hermana por
encima de la columna fija (la tapaba en tres tablas); medido en Chromium con Tab, en reposo y
desplazada. Capturas: 104 sin fallos.

## Informe del repaso de seguridad (0.9)

| Punto | Estado | Detalle |
|---|---|---|
| `.env` en `.gitignore` y `.env.example` sin claves | Ya estaba bien | Corregida la pista de `DATABASE_PATH` (relativa a `backend/`). |
| Ninguna clave en el historial de git | Ya estaba bien | Nunca se versionó un `.env`; ningún patrón de clave en `git log -p`. |
| uvicorn solo en 127.0.0.1 | Ya estaba bien (por defecto) | Ahora explícito en `start.sh`, con guarda. |
| CORS solo el Vite local | Ya estaba bien | `localhost:5173` y `127.0.0.1:5173`, sin credenciales. |
| Tickers validados en la frontera | **Arreglado** | 6 rutas sin validar (2 llegaban al proveedor); patrón endurecido (empieza por letra o número). |
| Rutas tapadas | **Arreglado** (encontrado de paso) | `/api/etfs/recomendar` nunca llegó a su manejador. |
| Dependencias | **Arreglado** | `npm audit fix` (nanoid, source-map-js); `pip-audit` sin avisos. |

## Dónde me quedé

(Si una sesión termina a mitad de un ítem, aquí va exactamente qué falta.)

Fase 1 cerrada; M1–M3 hechos y revisados (`05f6032`); 2.1 hecho (tres revisiones independientes
arregladas, capturas repetidas). Auditoría del 19 oct (A1–A7) hecha, con cuatro rondas de revisión
adversarial arregladas (la última, 22 hallazgos, en `5f6ddd3`…`f0d5757`). Lo siguiente es 2.2
(`AvisoAgrupado`).

Pendiente de Victor: `./start.sh validar` con claves (y `--grabar`); la hora real en el tipo de
cambio (`fx.tipo_desde_observaciones` mide la frescura con `date.today()`); las bandas de FX cerca
de la paridad; M10, M11 y M16; una regla de permisos para crear y empujar las etiquetas; el caso
del golden de tesis para un punto viejo en «veces»; servir con el redondeo del formateador (cambia
`decide` y `hoy` del golden); la caché de 6 h de Hoy (M3); la columna `registrado_en` de los lotes
de posición y el rastro de los puntos de tesis borrados (los dos piden migración); y aprobar la
migración 0009, que vacía la moneda «GBP» aprendida (se vuelve a aprender sola). De la cuarta
revisión: los topes de `TOPE_LEGADO` (10, 10 y 30) y una forma de confirmar la unidad de un punto
viejo sin borrarlo (un PATCH que conserve `created_at`; hoy rehacerlo lo saca de las
reconstrucciones anteriores); volver a ejecutar el backtest de reglas, porque los guardados sin
`banda_tendencia_pct` entraron con «precio > media» y siguen dando «calibrada» (¿invalidarlos, como
los anteriores al RC1?); y, si se quiere la cifra de la banda en el estado vacío de Hoy, servirla
en `thresholds` (cambia el golden de `hoy`).

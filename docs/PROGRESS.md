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

- [ ] **2.1** `<EstadoDato>` y estados de carga, vacío y error — estado: en curso (falta la revisión independiente y las capturas 1440/390) · commit: este · nota: `lib/useDato.ts` (cargando/listo/error, reintento, sin respuestas viejas al cambiar de clave) y `components/EstadoDato.tsx` (`EstadoDato` con los cuatro estados del backend, antes `SourceBadge`; `BloqueDatos` y `ErrorDeCarga` con «Reintentar»). Todas las cargas al montar del frontend pasan por ahí: 23 manejadores de error que no miraban el error (fallo pintado como vacío o callado) y los estados ad hoc de unas 30 cargas. La ficha se pinta sin cotización. Guarda: ESLint marca un `.then`/`.catch` cuyo manejador no recibe el error; 73 tests nuevos de render.
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
- [ ] **2.12** V2 · diseño móvil — estado: pendiente · commit: — · nota: —
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
| — | (revisor B5) Un instante sin zona: el backend lo escribe en UTC y el frontend en la hora del navegador | **para la Fase 2**: decidir si la pantalla rotula la hora local o escribe siempre UTC; hoy lo rotulado (replay, informe, datos de mercado) ya es explícito | — |
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

**Pendiente de la revisión independiente de M1–M3** (confirmado por un segundo agente; sin arreglar aún):

- M1: el análisis vigila el punto de noticias sobre la lista ya recortada para la pantalla (10
  titulares, sin resumen) y puede congelar «intacta» mientras Vigilancia, con hasta 60 y su resumen,
  lo da por cruzado. Pasar la lista completa (no anidada en `noticias`: la limpieza de la instantánea
  solo quita claves `_` del primer nivel) y, para el test, el `ahora` del análisis a `evaluar_noticia`.
- M1: unas noticias viejas rescatadas de la caché (hasta 7,5 h) cuentan como comprobadas; la sección
  de noticias no lee el `estado: viejo`.
- M1: «Qué cambió» presenta una caída de noticias como «Nuevos riesgos: Si hay un recall», sin el
  motivo; y el estado de la tesis sale como código en crudo (`sin_comprobar`, `sin_puntos` sin etiqueta).
- M2: un backtest de reglas de cripto decide si las de acciones están calibradas (no se filtra por
  clase); uno corto y no fiable posterior tapa una refutación fiable; el disclaimer de Hoy dice
  siempre «aún no están validadas»; el panel de Señales pinta en verde o rojo un backtest no fiable;
  «Media ganadora/perdedora» sale 0,00 cuando no hay operaciones de ese lado.
- M3: Hoy se cachea 6 h con la cartera y el efectivo de cuando se puntuó. Invalidar la caché al
  anotar efectivo dejaba la ficha sin puntuación (la toma de esa lista) y recalcular el tamaño al
  servirla contradice lo congelado. **Para Victor**: ¿recalcular y congelar de nuevo al servir, o basta
  con «Actualizar»?

**Notas de la migración del 2.1** (fuera de su alcance): `routers/options.py` aplana la cadena y tira
`estado`/`antiguedad_segundos` (una cadena vieja sale como normal); `CalidadSection` y `OptionsSection`
pintan códigos en mayúsculas sin `etiqueta()` (`BUENO`, `CONTANGO`…); Multifactor no enseña
`sin_puntuar`; el `DailyPrice` del frontend no declara `estado` (Hoy no dice «dato viejo» en la fila);
un replay pedido para un símbolo puede llegar tras cambiar de símbolo.

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

Fase 1 cerrada. Orden acordado con Victor el 9-oct: M1, M2 y M3 (revisión del 9-oct, arriba) y
después la Fase 2 de `docs/FIX_PLAN.md`, empezando por 2.1 (estados de dato), que ya tiene anotados:
la ficha sin cotización, los `?? 0`, los fallos que se pintan como vacío y las posiciones cerradas sin
moneda. Pendiente de Victor: `./start.sh validar` con claves (y `--grabar`), la hora real en
`thesis_watch` y en el tipo de cambio, las bandas de FX cerca de la paridad, M10, M11 y M16, y una
regla de permisos para crear y empujar las etiquetas.

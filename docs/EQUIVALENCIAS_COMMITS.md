# Equivalencias de commits

El 2026-10-09 la app pasó del repositorio `Vict0rL1/Sport-Betting` (antes `Vict0rL1/s`,
rama `claude/stock-analysis-app-nt3ge9`) a este. Los commits son los mismos, con los mismos
mensajes, fechas y autores, pero sus identificadores cambiaron: la historia ahora empieza en
«Fase 1» en vez de en la app de presupuesto sobre la que nació la rama.

Los documentos escritos antes de esa fecha citan los identificadores viejos. Esta tabla da el
nuevo para cada uno de los que aparecen en `docs/`, `CLAUDE.md`, `README.md` y `TODO.md`.

| Antes | Ahora | Commit |
|---|---|---|
| `00c5b77` | `b3bd991` | feat(1.7): un solo formato de cifras y fechas, igual en backend y frontend |
| `02e6fc3` | `fdb6acf` | fix(1.12): una serie de cambio fuera de su banda es un fallo del proveedor |
| `07b5e1a` | `2fada7b` | P0-6 y P0-7: la valoración deja de inventar deuda y crecimiento |
| `0c6ec32` | `ba517e1` | chore(0.5): tests contra fugas de texto en backend y frontend, con trinquete |
| `0e0c3df` | `d0bd168` | feat(1.13): ./start.sh validar y un informe de validación que dice qué mirar a mano |
| `105d39f` | `11f0a66` | fix(V4): las cifras en millones pasan por fmtCompacto |
| `13aefc3` | `7fa9ee6` | fix(0.8): la copia de la base ya no se salta en silencio ni la esquiva ningún camino |
| `173dfd2` | `1407a30` | Instantáneas de decisión congeladas: la base del forward testing |
| `17d0b76` | `8bb03b3` | fix(V13): sin mensajes que adivinan una causa que ya no existe |
| `1aeb8f0` | `b1d2e2a` | fix(V4): ninguna fecha para una persona sale en ISO; la hora de mercado lleva «ET» |
| `1c99295` | `a3973f6` | chore(0.4): paquete de casos extremos compartido por golden, fugas y capturas |
| `1fa46c5` | `d46b1f7` | chore(0.2): integración continua con tests, tipos, lint, build y auditorías |
| `2ad459b` | `ed86332` | fix(V6): ningún código interno en pantalla; un diccionario de etiquetas y un glosario |
| `34b23d3` | `84fbf07` | fix(1.11): el modelo de Claude sale de CLAUDE_MODEL y un id inválido se dice |
| `3807b51` | `9ac9d98` | fix(0.6): la demo de las capturas ya no inventa datos para la empresa sin datos |
| `399d9eb` | `a93a3d7` | chore(0.6): capturas repetibles de todas las pantallas con un solo comando |
| `4742548` | `3ed65fd` | fix(0.3): el golden ve todos los umbrales y no descarta códigos con tilde |
| `4796384` | `050f43f` | fix(V4, V8): el backend escribe sus cifras en es-ES con app/formato.py |
| `492571a` | `2ef5b14` | fix(V4): el backend tampoco escribe «%» a mano tras una interpolación |
| `4f6042e` | `8a5372c` | chore(0.7): grabar y reproducir respuestas reales de los proveedores |
| `50675ff` | `c0567a5` | Alembic, restricciones de integridad y entrada de datos a prueba de dobles clics |
| `53f6c2a` | `195c9ea` | P0-1 y P0-2: un precio corrupto ya no produce una orden de compra |
| `5888372` | `67d8c97` | Alertas: error ≠ sin datos, cada alerta aislada, registro y aviso de lo atascado |
| `5a4f217` | `ef3587e` | fix(V7): plurales de verdad y concordancia en todas las frases con recuento |
| `5e80190` | `91084de` | Docs: lotes agregados, barras del mismo día y Ronda 2 en el checklist |
| `5eee473` | `f198031` | fix(0.9): validación común de tickers en toda la API y repaso de seguridad |
| `62f3b08` | `4fa734e` | fix(V11): «Deuda y solidez» ya no dice «sin datos» con la deuda neta al lado |
| `6dca25a` | `0446c6f` | fix(revisión F1): cualquier divisa distinta de la base en pantalla es mezcla |
| `6eab884` | `1ae73f9` | Fechas de posiciones y watchlist con zona: una compra no cambia de día |
| `77b3e9d` | `0a1b9ee` | Divisas: la conversión no se ejecutaba con Finnhub, y /riesgo no convertía |
| `79493ba` | `510a12b` | El dato viejo se ve en pantalla y no basta para comprar |
| `7b8994f` | `8701e16` | chore(0.8): copia de seguridad de la base antes de cada arranque |
| `7fe1398` | `a58f18e` | fix(V7): los recuentos que quedaron fuera de 1.9 concuerdan con su número |
| `81d6cae` | `f2c2af9` | docs: cierre de la Fase 1 (capturas «después» y estado en PROGRESS) |
| `8301e07` | `6bd31e4` | Validación fuera de muestra, costes desagregados y distribuciones |
| `87ea405` | `187c5c4` | Solapamiento de ETFs desconocido ≠ 0 %, y los límites no aplicados se ven |
| `8ffec21` | `fc6ffbb` | fix(V6): siglas, acciones del diario y diccionarios paralelos pasan por etiqueta() |
| `9033df0` | `6129c7c` | P0-6 de verdad: la primera corrección no llegaba al endpoint |
| `903f026` | `ef907f7` | P0-3/4/5: el dimensionador deja de fallar abierto y declara qué no comprobó |
| `90924e9` | `ef04f2a` | feat(1.1): tokens semánticos de color, leerToken y test de contraste |
| `940e18f` | `4df87c0` | fix(revisión F1): el stop de una idea nueva se pinta por debajo del precio |
| `9439108` | `3ddd015` | chore(0.3): golden master del motor para probar que el plan no cambia decisiones |
| `95d7efb` | `aabe25d` | fix(0.6): el script de capturas falla de verdad y la recomendación de ETFs se fotografía |
| `9a71543` | `52a07c5` | fix(0.7, 0.4): el contrato con datos reales no pasa en vacío y los casos extremos dicen lo que son |
| `9c68e0f` | `6ce3bdd` | fix(V9): lo generado por IA se lee y se ve como IA en el tema oscuro |
| `a0f0255` | `fa3ea76` | fix(0.9): validación de tickers sin cambiar el contrato, con un solo validador y URLs codificadas |
| `a3aa047` | `1e9e4a2` | chore(0.1): tests de frontend con Vitest, Testing Library y jsdom |
| `a719b3a` | `5e677ef` | Cierra dos riesgos residuales: stop de posiciones antiguas y backtests pre-RC1 |
| `aadd0d7` | `98c3d7f` | fix(V13): los mensajes de fallo dicen la causa que se sabe, no la que se adivina |
| `bfba8f9` | `684c955` | fix(V1): el gráfico de precios usa los colores del tema oscuro |
| `ca51076` | `3016307` | Holdout bloqueado de verdad, índice externo, exposición y costes en la validación |
| `cc5ed78` | `0f8214c` | fix(V4): los porcentajes del frontend llevan espacio duro antes de «%» |
| `d78926e` | `877428d` | docs(0): cierre de la Fase 0 tras la revisión independiente |
| `d97b44a` | `6a02f81` | fix(V4): los ejes y la cruz del gráfico usan el formato de la app |
| `ddd3b6e` | `0181c3d` | Los estados financieros de EDGAR también pasan por la frontera de validación |
| `e0067d7` | `37a93cd` | Arreglar seis bugs: el límite por correlación no se ejecutaba nunca |
| `e3265f5` | `74249b1` | Alertas que avisan con la app cerrada: cron + notificación de escritorio |
| `e3dd6ad` | `7500378` | fix(revisión F1): lo que falta se dice en vez de pintar un cero o desaparecer |
| `e3e223e` | `91c3507` | Test de extremo a extremo con la pila real, y el estado del dato llega al cliente |
| `e70f3a8` | `82ca44a` | fix(V18): las tasas de crecimiento dicen la ventana que tienen, no «5A» siempre |
| `e7cc849` | `99f0d3f` | fix(0.5): el trinquete de fugas cuenta por sitio y por número de apariciones |
| `e87e67e` | `c9c9128` | fix(V6): cinco pantallas enseñaban códigos con los guiones bajos cambiados por espacios |
| `e917365` | `de14316` | chore(plan): plan de correcciones, registro de progreso y revisión de partida |
| `f124d24` | `089a9d6` | El stop se fija al abrir: recalcularlo con la volatilidad de hoy lo evitaba |
| `f21c559` | `503b1c3` | fix(revisión F1): un replay sin marcas de tiempo dice que no se comprobó |
| `f2ff481` | `ffd5de4` | Frontera de validación, rescate de dato viejo, limpieza y registro por categorías |
| `f338493` | `022552e` | Con un precio viejo, una alerta no puede decir «no salta», y la cartera lo avisa |
| `f3e1427` | `27f98be` | fix(revisión F1): el SMA 200 y el RSI dejan el violeta de la IA |
| `f6f3d59` | `cbead9f` | fix(V4): numpy y Decimal son cifras; un instante futuro no es «hace segundos» |
| `fc7e0d6` | `a5d58c1` | fix(V3): un día sin candidatas dice que no hay nada que repartir, sin «undefined %» |

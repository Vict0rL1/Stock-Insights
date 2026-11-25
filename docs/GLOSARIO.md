# Glosario

Un término por concepto en toda la app (ítem 1.8 del plan de correcciones).
La columna **Nunca** no es decorativa: `backend/tests/test_glosario.py` la lee
y falla si uno de esos términos aparece en un texto para el usuario, sea del
backend (sobre el paquete de casos extremos), del frontend (cadenas y texto
JSX de `frontend/src`) o del diccionario de etiquetas (`backend/app/etiquetas.py`).
Para añadir una prohibición, se añade aquí.

Las etiquetas de los códigos internos (`gross_margin` → «margen bruto») viven
en `backend/app/etiquetas.py`; este documento fija las palabras. Lo que la ficha
explica al tocar un término («¿qué es el PER?») vive en `frontend/src/lib/glosario.ts`:
cada entrada nombra su fila de aquí por el concepto, y `glosario.test.ts` falla si
el término no es el de esta tabla o si su definición usa algo de la columna «Nunca».

| Concepto | Término | Nunca | Nota |
|---|---|---|---|
| Beneficio por acción | BPA | EPS | «BPA diluido», «crecimiento del BPA». |
| Flujo de caja libre | flujo de caja libre (FCF) | FCF yield, free cash flow | «FCF» solo como abreviatura en compuestos ya fijados: «margen de FCF», «FCF de partida», «rentabilidad por FCF». |
| Rentabilidad del flujo de caja libre sobre el precio | rentabilidad por FCF | FCF yield | |
| Rentabilidad por dividendo | rentabilidad por dividendo | Div. yield, dividend yield | |
| Coste anual de un ETF | coste anual | Expense ratio | Se explica en dinero: «75 al año por cada 10.000 invertidos». |
| Nivel de salida por pérdida | stop | stop loss, stop-loss | Se fija al abrir la posición. |
| Valor relativo frente a comparables | puntuación | | «z-score» solo dentro de una explicación técnica. |
| Postura escrita sobre una empresa | tesis | | Con puntos de invalidación medibles. |
| Precio entre beneficio por acción | PER | | Precio de hoy / BPA del último ejercicio. En la ficha, «PER (precio / beneficio)». **Pendiente**: las tablas de Fundamentales básicos, Valoración e Informe aún dicen «P/E». |
| Beneficio de la operación sobre las ventas | margen operativo | | Resultado operativo / ingresos. |
| Precio medio de cierre de las últimas 200 sesiones | media de 200 sesiones | | La que mide la tendencia en el motor; en el gráfico, la línea «SMA 200». |
| Crecimiento del FCF que justifica el precio | crecimiento que da por hecho el precio | | El DCF inverso: con supuestos fijos, no es una previsión. |
| Valor en bolsa de la empresa | capitalización | | Precio por acciones en circulación. |
| Calidad de la evidencia de una decisión | confianza | | Alta, media o baja; no es la probabilidad de acertar. |
| Lo que tienes de un valor | posición | | Varios lotes del mismo símbolo son una posición. |
| Todo lo que tienes | cartera | | «Mi cartera» (`/cartera`) junta Portafolio, Cartera, Tesis y Vigilancia en tres sub-pestañas (fase 3, 3.1 y 3.2); el menú deja de nombrar «Portafolio» cuando entra la navegación nueva. |
| Lista de valores seguidos | lista de seguimiento | | En Mi cartera › Tesis y vigilancia ya se llama así; quedan «watchlist» en textos de otras pantallas y del backend. |
| Previsión que publica la propia empresa | guidance de la dirección | | Extraída por IA con cita verificada; nunca se presenta como dato calculado. |
| Ganancia o pérdida | P&L | | «realizado» (posiciones cerradas) y «no realizado» (abiertas). |
| Precio fuera de lo esperable | precio viejo | | Rescatado de caché porque todas las fuentes fallaron; siempre con su antigüedad. |
| Dato que falta | sin datos / desconocido | | Ausente ≠ cero: nunca se rellena con 0. |

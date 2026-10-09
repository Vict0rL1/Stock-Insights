# Análisis bursátil · Handoff

Estado a fecha 2026-10-09. Este repositorio contiene solo la app local de
análisis bursátil (FastAPI + React). Para trabajar en ella, lee primero este
archivo y luego `CLAUDE.md` (reglas y convenciones), `README.md`,
`docs/PROGRESS.md` (estado por fases) y `TODO.md`.

## Origen

Hasta el 2026-10-09 la app vivía en la rama `claude/stock-analysis-app-nt3ge9`
del repositorio `Vict0rL1/Sport-Betting` (antes llamado `Vict0rL1/s`), con su
PR #5. Se movió aquí con todo su historial:

- Sus 146 commits, desde «Fase 1» hasta el cierre de la Fase 1 del plan
  actual, con los mismos mensajes, fechas y autores. Quedan fuera solo los 2
  commits de la antigua app de presupuesto sobre la que nació la rama: el
  primer commit de la app ya borraba todos sus archivos.
- Los archivos son idénticos a los de la rama original en `a12a225`.
- Al empezar la historia en «Fase 1», los identificadores de los commits
  cambiaron. Los documentos anteriores a esta fecha citan los viejos:
  `docs/EQUIVALENCIAS_COMMITS.md` da el nuevo para cada uno.
- La rama original y la conversación del PR #5, ya cerrado, siguen en
  `Sport-Betting` como archivo.

No cambió nada más: el CI (`.github/workflows/ci.yml`) ya corría desde la raíz
en cada push y PR, y la app no tiene despliegue ni secretos en GitHub. Las
claves de los proveedores siguen yendo en el `.env` local, como explica el
README.

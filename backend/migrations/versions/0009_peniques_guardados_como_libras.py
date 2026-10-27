"""El «GBP» que el código anterior guardó por un «GBp» (peniques).

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-27

Hasta la revisión de A3, la moneda que llegaba de Yahoo se pasaba a mayúsculas
a ciegas, y el «GBp» de la Bolsa de Londres (peniques) quedaba guardado en
`instruments.currency` como «GBP» (libras). Cuando la cotización llega sin
moneda (Finnhub no la trae nunca) o en una posición cerrada, manda la guardada,
y la posición se convertía como libras: cien veces su valor, sin aviso.

No se puede saber cuáles eran libras de verdad, así que se vacían todas. La
moneda de un instrumento no la escribe el usuario: se aprende del proveedor y se
vuelve a aprender (`fx.codigo`) con la siguiente cotización o el perfil. Si no
llega, queda desconocida y la posición sale fuera de los totales, nombrada: el
lado seguro. No se toca ninguna otra fila ni columna.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: Union[str, Sequence[str], None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if "currency" in {c["name"] for c in sa.inspect(op.get_bind()).get_columns("instruments")}:
        op.execute(sa.text("UPDATE instruments SET currency = NULL WHERE currency = 'GBP'"))


def downgrade() -> None:
    # Nada que deshacer: la moneda se vuelve a aprender sola, y reponer «GBP»
    # sería volver a convertir peniques como libras.
    pass

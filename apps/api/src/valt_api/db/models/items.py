from sqlalchemy import BigInteger, CheckConstraint, Identity, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from valt_api.db.base import Base, TimestampMixin


class ItemRow(TimestampMixin, Base):
    """Items table. Owner scoping (owner_id) arrives with users in Phase 2."""

    __tablename__ = "items"
    __table_args__ = (CheckConstraint("length(btrim(name)) > 0", name="name_not_blank"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

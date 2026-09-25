"""Import every model module here so Base.metadata is complete for Alembic."""

from valt_api.db.models.items import ItemRow

__all__ = ["ItemRow"]

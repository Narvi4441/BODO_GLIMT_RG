"""Conexión compartida a PostgreSQL mediante SQLAlchemy Core, sin ORM."""
from functools import lru_cache
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine, make_url
from app.core.config import Config


class DatabaseNotConfigured(RuntimeError):
    pass


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    if not Config.SQLALCHEMY_DATABASE_URI:
        raise DatabaseNotConfigured("Configura DATABASE_URL en backend/.env")
    url = make_url(Config.SQLALCHEMY_DATABASE_URI)
    if url.drivername in {"postgres", "postgresql"}:
        url = url.set(drivername="postgresql+psycopg2")
    return create_engine(
        url,
        pool_pre_ping=True,
        hide_parameters=True,
        connect_args={"connect_timeout": 5},
    )

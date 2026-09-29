"""SQLAlchemy Core, como el diagnóstico existente; sin ORM ni tablas nuevas."""
from functools import lru_cache
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from app.core.config import Config


class DatabaseNotConfigured(RuntimeError):
    pass


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    if not Config.SQLALCHEMY_DATABASE_URI:
        raise DatabaseNotConfigured("Configura DATABASE_URL en backend/.env")
    return create_engine(
        Config.SQLALCHEMY_DATABASE_URI,
        pool_pre_ping=True,
        hide_parameters=True,
        connect_args={"connect_timeout": 5},
    )

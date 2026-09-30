"""Manually prepare the optional journey table. Never run during app startup."""
import sys
from pathlib import Path

from sqlalchemy import text

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.database import get_engine


def main() -> None:
    with get_engine().begin() as connection:
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS viajes (
                journey_id VARCHAR(36) PRIMARY KEY,
                id_usuario INTEGER NOT NULL
                    REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
                status VARCHAR(20) NOT NULL,
                started_at TIMESTAMPTZ NOT NULL,
                ended_at TIMESTAMPTZ NULL
            )
        """))
    print("OK: tabla viajes creada/verificada.")


if __name__ == "__main__":
    main()

"""Manual creation of the two optional command persistence tables."""
import sys
from pathlib import Path

from sqlalchemy import text

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.database import get_engine


def main() -> None:
    with get_engine().begin() as connection:
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS comandos (
                command_id VARCHAR(36) PRIMARY KEY,
                journey_id VARCHAR(36) NOT NULL
                    REFERENCES viajes(journey_id)
                    ON DELETE CASCADE,
                id_usuario INTEGER NOT NULL
                    REFERENCES usuarios(id_usuario)
                    ON DELETE CASCADE,
                action VARCHAR(50) NOT NULL,
                value JSONB NULL,
                status VARCHAR(20) NOT NULL,
                message TEXT NULL,
                created_at TIMESTAMPTZ NOT NULL
            );
        """))
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS command_eventos (
                id_evento BIGSERIAL PRIMARY KEY,
                command_id VARCHAR(36) NOT NULL
                    REFERENCES comandos(command_id)
                    ON DELETE CASCADE,
                status VARCHAR(20) NOT NULL,
                message TEXT NULL,
                created_at TIMESTAMPTZ NOT NULL
                    DEFAULT CURRENT_TIMESTAMP
            );
        """))
    print("OK: tablas comandos y command_eventos creadas/verificadas.")


if __name__ == "__main__":
    main()

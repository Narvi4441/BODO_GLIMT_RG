"""Manually prepare the optional telemetry table; never run at app startup."""
import sys
from pathlib import Path

from sqlalchemy import text

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.database import get_engine


def main() -> None:
    with get_engine().begin() as connection:
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS telemetria (
                id_telemetria BIGSERIAL PRIMARY KEY,
                journey_id VARCHAR(36) NOT NULL
                    REFERENCES viajes(journey_id)
                    ON DELETE CASCADE,
                received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                payload JSONB NOT NULL,
                risk_score INTEGER NULL,
                risk_status VARCHAR(20) NULL
            );
        """))
    print("OK: tabla telemetria creada/verificada.")


if __name__ == "__main__":
    main()

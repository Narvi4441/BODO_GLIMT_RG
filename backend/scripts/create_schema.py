from sqlalchemy import text

from app.core.database import get_engine


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS usuarios (
    id_usuario SERIAL PRIMARY KEY,
    nombre_completo VARCHAR(150) NOT NULL,
    telefono VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tutores (
    id_tutor SERIAL PRIMARY KEY,
    nombre_completo VARCHAR(150) NOT NULL,
    telefono VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS usuarios_tutores (
    id_usuario INTEGER NOT NULL
        REFERENCES usuarios(id_usuario)
        ON DELETE CASCADE,

    id_tutor INTEGER NOT NULL
        REFERENCES tutores(id_tutor)
        ON DELETE CASCADE,

    relacion VARCHAR(50) NOT NULL,
    permisos VARCHAR(50) NOT NULL DEFAULT 'LECTURA_TOTAL',

    PRIMARY KEY (id_usuario, id_tutor)
);
"""


def main() -> None:
    engine = get_engine()

    statements = [
        statement.strip()
        for statement in SCHEMA_SQL.split(";")
        if statement.strip()
    ]

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))

    print("OK: esquema inicial creado/verificado.")
    print("Tablas: usuarios, tutores, usuarios_tutores")


if __name__ == "__main__":
    main()

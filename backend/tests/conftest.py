import os
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from app.main import app
from app.services import auth

# Tablas de prueba: las tres definiciones proporcionadas, sin nuevas relaciones.
DDL = """
CREATE TABLE usuarios (
 id_usuario SERIAL PRIMARY KEY, nombre_completo VARCHAR(150) NOT NULL,
 password_hash VARCHAR(255) NOT NULL, telefono VARCHAR(20) UNIQUE NOT NULL,
 email VARCHAR(100) UNIQUE NOT NULL, dispositivo_modelo VARCHAR(50),
 app_version VARCHAR(15), creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE tutores (
 id_tutor SERIAL PRIMARY KEY, nombre_completo VARCHAR(150) NOT NULL,
 telefono VARCHAR(20) UNIQUE NOT NULL, email VARCHAR(100) UNIQUE NOT NULL,
 creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE usuarios_tutores (
 id_usuario INT REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
 id_tutor INT REFERENCES tutores(id_tutor) ON DELETE CASCADE,
 relacion VARCHAR(50), permisos VARCHAR(50) DEFAULT 'LECTURA_TOTAL',
 PRIMARY KEY (id_usuario, id_tutor)
);
"""


@pytest.fixture
def database(monkeypatch):
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Configura TEST_DATABASE_URL: PostgreSQL exclusivo de pruebas")
    if not make_url(url).database.endswith("_test"):
        pytest.fail("TEST_DATABASE_URL debe apuntar a una BD terminada en _test")
    admin = create_engine(url, hide_parameters=True)
    schema = "guardian_test_" + uuid4().hex
    # Identificador generado internamente; nunca proviene de un request.
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, hide_parameters=True, connect_args={"options": f"-csearch_path={schema}"})
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(DDL)
        monkeypatch.setattr(auth, "get_engine", lambda: engine)
        yield engine
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


@pytest.fixture
def client(database):
    with TestClient(app) as client:
        yield client


@pytest.fixture
def payload():
    return {"nombre_completo": "Ana Prueba", "telefono": "55 1234 5678",
            "email": "ana@example.com", "password": "Una clave segura 42!",
            "confirm_password": "Una clave segura 42!",
            "tutor": {"nombre_completo": "Laura Prueba", "telefono": "55 9876 5432",
                      "email": "laura@example.com", "relacion": "Madre"}}

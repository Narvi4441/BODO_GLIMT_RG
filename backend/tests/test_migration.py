from pathlib import Path
import pytest
from sqlalchemy import text


@pytest.mark.parametrize("legacy_user", [False, True])
def test_password_migration_is_idempotent_and_preserves_legacy_users(database, legacy_user):
    with database.begin() as connection:
        connection.exec_driver_sql("ALTER TABLE usuarios DROP COLUMN password_hash")
        if legacy_user:
            connection.exec_driver_sql("INSERT INTO usuarios (nombre_completo, telefono, email) VALUES ('Cuenta anterior', '5511111111', 'legacy@example.com')")
    migration = (Path(__file__).resolve().parents[1] / "migrations/001_usuarios_password_hash.sql").read_text(encoding="utf-8")
    # Mismo SQL dirigido al schema aislado de esta prueba, nunca al public del usuario.
    migration = migration.replace("public.usuarios", "usuarios")
    for _ in range(2):
        with database.connect() as connection:
            connection.exec_driver_sql(migration)
    with database.connect() as connection:
        nullable = connection.execute(text("""
            SELECT is_nullable FROM information_schema.columns
            WHERE table_schema=current_schema() AND table_name='usuarios' AND column_name='password_hash'
        """)).scalar_one()
        assert nullable == ("YES" if legacy_user else "NO")
        assert connection.execute(text("SELECT count(*) FROM usuarios")).scalar_one() == int(legacy_user)

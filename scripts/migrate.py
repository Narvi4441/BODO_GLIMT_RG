"""Incremental migrations against the existing schema; no seeded/sample records."""
import argparse
import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from sqlalchemy import text
from app.core.database import get_engine


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Inspect schema and pending migrations only")
    args = parser.parse_args()
    paths = sorted((ROOT / "backend/migrations").glob("*.sql"))
    with get_engine().connect() as c:
        for table in ("usuarios", "viajes", "alertas"):
            columns = c.execute(text("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=:name ORDER BY ordinal_position"), {"name": table}).scalars().all()
            print(f"{table}: {', '.join(columns) or 'NO EXISTE'}")
        if args.check:
            print("Scripts disponibles:", ", ".join(p.name for p in paths))
            return
    # Journal introduced explicitly here; every migration and its receipt commit atomically.
    with get_engine().begin() as c:
        c.execute(text("SELECT pg_advisory_xact_lock(714051)"))
        c.exec_driver_sql("CREATE TABLE IF NOT EXISTS public.guardian_migrations(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())")
        for path in paths:
            sql = path.read_text(encoding="utf-8-sig")
            digest = hashlib.sha256(sql.encode()).hexdigest()
            old = c.execute(text("SELECT sha256 FROM public.guardian_migrations WHERE name=:name"), {"name": path.name}).scalar()
            if old:
                if old != digest:
                    raise RuntimeError(f"Migration already applied with another checksum: {path.name}")
                print("Ya aplicada:", path.name)
                continue
            if path.name.startswith("001_"):
                exists = c.execute(text("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='usuarios' AND column_name='password_hash'")).scalar()
                if exists:
                    print("password_hash ya existe; 001 no altera usuarios")
                else:
                    c.exec_driver_sql(_transaction_body(sql), execution_options={"no_parameters": True})
            else:
                c.exec_driver_sql(_transaction_body(sql), execution_options={"no_parameters": True})
            c.execute(text("INSERT INTO public.guardian_migrations(name,sha256) VALUES(:name,:hash)"), {"name": path.name, "hash": digest})
            print("Aplicada:", path.name)


def _transaction_body(sql):
    # Preserve DO $$ BEGIN ... END $$; strip only standalone transaction delimiters.
    return "\n".join(line for line in sql.splitlines() if line.strip().upper() not in {"BEGIN;", "COMMIT;"})


if __name__ == "__main__":
    main()

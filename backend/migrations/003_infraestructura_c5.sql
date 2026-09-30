BEGIN;
CREATE TABLE IF NOT EXISTS public.infraestructura_c5 (
 id TEXT PRIMARY KEY, source TEXT NOT NULL,
 direccion TEXT, esquina TEXT, colonia TEXT, alcaldia TEXT,
 poste TEXT, boton TEXT, altavoz TEXT,
 latitude DOUBLE PRECISION NOT NULL CHECK(latitude BETWEEN -85.05112878 AND 85.05112878),
 longitude DOUBLE PRECISION NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 metadata JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
-- Use PostGIS only if already installed; do not install an extension silently.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='postgis') THEN
  ALTER TABLE public.infraestructura_c5 ADD COLUMN IF NOT EXISTS location geography(Point,4326);
  UPDATE public.infraestructura_c5
   SET location=ST_SetSRID(ST_MakePoint(longitude,latitude),4326)::geography;
  CREATE INDEX IF NOT EXISTS idx_infraestructura_c5_location
   ON public.infraestructura_c5 USING GIST(location);
 END IF;
END $$;
COMMIT;

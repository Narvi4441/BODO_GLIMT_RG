BEGIN;
-- Fail closed on the incompatible table created by the old scripts/init_db.py.
-- Never rename/drop a primary key or manufacture missing user/route data.
DO $$
DECLARE missing text;
BEGIN
 SELECT string_agg(required.name, ', ') INTO missing
 FROM (VALUES ('id_viaje'), ('id_usuario'), ('origen_lat'), ('origen_lon'),
 ('destino_lat'), ('destino_lon'), ('ruta_oficial'), ('eta_original'),
 ('estado'), ('inicio_viaje'), ('fin_viaje')) AS required(name)
 WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
 WHERE table_schema='public' AND table_name='viajes' AND column_name=required.name);
 IF missing IS NOT NULL THEN
  RAISE EXCEPTION 'viajes incompatible. Faltan columnas: %. Revise el esquema antes de migrar.', missing;
 END IF;
 IF to_regclass('public.usuarios') IS NULL OR to_regclass('public.alertas') IS NULL THEN
  RAISE EXCEPTION 'Se requieren las tablas existentes usuarios y alertas';
 END IF;
END $$;

ALTER TABLE public.viajes ADD COLUMN IF NOT EXISTS journey_id UUID;
UPDATE public.viajes SET journey_id=gen_random_uuid() WHERE journey_id IS NULL;
ALTER TABLE public.viajes ALTER COLUMN journey_id SET DEFAULT gen_random_uuid();
ALTER TABLE public.viajes ALTER COLUMN journey_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS viajes_journey_id_unique ON public.viajes(journey_id);
ALTER TABLE public.viajes ADD COLUMN IF NOT EXISTS user_id TEXT;
UPDATE public.viajes SET user_id=id_usuario::text WHERE user_id IS NULL AND id_usuario IS NOT NULL;
-- Legacy rows with no user remain NULL: do not invent their identity.
ALTER TABLE public.viajes ADD COLUMN IF NOT EXISTS last_telemetry_at TIMESTAMPTZ;
ALTER TABLE public.viajes ADD COLUMN IF NOT EXISTS online BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.viajes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.viajes ALTER COLUMN id_usuario DROP NOT NULL;
ALTER TABLE public.viajes ALTER COLUMN origen_lat DROP NOT NULL;
ALTER TABLE public.viajes ALTER COLUMN origen_lon DROP NOT NULL;
ALTER TABLE public.viajes ALTER COLUMN destino_lat DROP NOT NULL;
ALTER TABLE public.viajes ALTER COLUMN destino_lon DROP NOT NULL;
ALTER TABLE public.viajes ALTER COLUMN ruta_oficial DROP NOT NULL;
ALTER TABLE public.viajes ALTER COLUMN eta_original DROP NOT NULL;
-- A previous optional route migration may have introduced this column.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
 AND table_name='viajes' AND column_name='ruta_esperada') THEN
  ALTER TABLE public.viajes ALTER COLUMN ruta_esperada DROP NOT NULL;
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.telemetria (
 id_telemetria BIGSERIAL PRIMARY KEY,
 journey_id UUID NOT NULL REFERENCES public.viajes(journey_id),
 id_usuario INTEGER REFERENCES public.usuarios(id_usuario),
 user_id TEXT NOT NULL,
 latitude DOUBLE PRECISION NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude DOUBLE PRECISION NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 accuracy DOUBLE PRECISION, speed DOUBLE PRECISION, heading DOUBLE PRECISION,
 battery DOUBLE PRECISION, latency_ms DOUBLE PRECISION, packet_loss DOUBLE PRECISION,
 network_status TEXT NOT NULL, route_deviation_m DOUBLE PRECISION,
 risk_score INTEGER NOT NULL, risk_status TEXT NOT NULL, risk_reasons JSONB NOT NULL,
 timestamp TIMESTAMPTZ NOT NULL, creado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_telemetria_journey ON public.telemetria(journey_id, id_telemetria DESC);
CREATE INDEX IF NOT EXISTS idx_telemetria_timestamp ON public.telemetria(timestamp);
CREATE INDEX IF NOT EXISTS idx_telemetria_usuario ON public.telemetria(id_usuario);

CREATE TABLE IF NOT EXISTS public.comandos (
 command_id UUID PRIMARY KEY, journey_id UUID NOT NULL REFERENCES public.viajes(journey_id),
 id_usuario INTEGER REFERENCES public.usuarios(id_usuario), user_id TEXT NOT NULL,
 action TEXT NOT NULL, value JSONB,
 status TEXT NOT NULL CHECK(status IN ('SENT','RECEIVED','EXECUTING','EXECUTED','FAILED')),
 message TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_comandos_journey_status ON public.comandos(journey_id,status);
CREATE TABLE IF NOT EXISTS public.eventos_viaje (
 id BIGSERIAL PRIMARY KEY, journey_id UUID NOT NULL REFERENCES public.viajes(journey_id),
 event_type TEXT NOT NULL, payload JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_eventos_viaje ON public.eventos_viaje(journey_id,id DESC);
-- COMMAND_ACK events keep every accepted transition, including message and command_id.
COMMIT;

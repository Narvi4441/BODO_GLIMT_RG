BEGIN;
-- The documented NUMERIC(10,8) longitude accepts only +/-99.99999999,
-- while the existing GPS API accepts +/-180. Widen only when necessary.
DO $$
DECLARE target record;
BEGIN
 FOR target IN
  SELECT table_name,column_name,numeric_scale FROM information_schema.columns
  WHERE table_schema='public' AND data_type='numeric'
   AND numeric_precision-numeric_scale < 3
   AND ((table_name='viajes' AND column_name IN ('origen_lon','destino_lon'))
     OR (table_name='alertas' AND column_name='lon_incidente'))
 LOOP
  EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE NUMERIC(%s,%s)',
    target.table_name,target.column_name,
    3+greatest(8,target.numeric_scale),greatest(8,target.numeric_scale));
 END LOOP;
END $$;
COMMIT;

-- Ejecutar explícitamente en la BD correcta. No se ejecuta al iniciar FastAPI.
BEGIN;
ALTER TABLE public.usuarios
    ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
-- Si ya hay usuarios sin contraseña, conservarlos sin inventarles una contraseña.
-- No podrán iniciar sesión hasta un proceso seguro de asignación/restablecimiento.
-- Si no hay NULL, imponer NOT NULL como en el esquema suministrado.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE password_hash IS NULL) THEN
        ALTER TABLE public.usuarios ALTER COLUMN password_hash SET NOT NULL;
    END IF;
END $$;
COMMIT;

# Registro real de GUARDIAN CORE

## Qué se encontró y qué se cambió

- FastAPI ya usa routers, Pydantic y servicios. SQLAlchemy solo se usaba en `core/test_conexion.py`; se reutiliza su estilo con `create_engine` y `text`, sin ORM ni modelos/tablas adicionales.
- No existían endpoints de autenticación ni archivos de dependencias. Se añaden solamente `POST /api/auth/register`, `POST /api/auth/login` y el montaje estático `/ui/`.
- `config.py` contenía secretos y la contraseña configurada era rechazada por PostgreSQL. Ahora carga variables/`backend/.env`. La contraseña y clave que estuvieron en el código deberían rotarse; quitarlas del archivo no las retira del historial Git.
- Redis usaba 6379 en config, pero Docker y C5 usan 6380. El valor predeterminado de config se alineó a 6380; `docker-compose.yml` y el servicio C5 se conservaron.
- El frontend es un HTML con Tailwind/CDN, Leaflet, D3 y mocks, no React/Vite en esta versión. Se conservan esos elementos. Se añadió el formulario al login y se separaron sus handlers en `auth.js`, inicializados dentro del DOMContentLoaded existente.
- No hay archivos de manifest/service worker ni referencias a ellos. No se inventó una estrategia de caché PWA inexistente. Las rutas de cuentas no cachean respuestas; `/ui/` revalida recursos.

## API de registro

```http
POST /api/auth/register
Content-Type: application/json
```

```json
{
  "nombre_completo": "Ana Prueba",
  "telefono": "5512345678",
  "email": "ana@example.com",
  "password": "Una clave segura 42!",
  "confirm_password": "Una clave segura 42!",
  "tutor": {
    "nombre_completo": "Laura Prueba",
    "telefono": "5598765432",
    "email": "laura@example.com",
    "relacion": "Madre"
  }
}
```

Éxito **201**: `{"success":true,"message":"Usuario registrado correctamente"}`.

Error **409**, por ejemplo:
```json
{"success":false,"message":"Este correo ya está registrado.","errors":{"email":"Este correo ya está registrado."}}
```

**422**: validación; **401**: credenciales incorrectas en login; **503**: BD/configuración/migración no disponible. Los errores no incluyen el cuerpo de entrada, hashes, SQL ni credenciales. Las respuestas usan `Cache-Control: no-store`.

Se eliminan espacios de nombres/correos y se normalizan correos a minúsculas. Teléfonos: 10–15 dígitos, se admiten `+`, espacios, paréntesis, puntos y guiones, y se almacenan solo dígitos. No se adivinan prefijos de país: usa consistentemente la misma representación. Nombres hasta 150, correo hasta 100, relación hasta 50 caracteres, conforme a la BD. Contraseña de 8–128 caracteres, sin recortarla; se rechazan solo espacios. No se aceptan `role`, IDs, `permisos` ni campos adicionales.

La prevalidación detecta también correos antiguos con mayúsculas y teléfonos con separadores. Los nuevos valores canónicos y las restricciones UNIQUE existentes resuelven registros concurrentes sin añadir índices. No se convierten ni fusionan datos antiguos.

`usuarios`, `tutores` y `usuarios_tutores` se insertan mediante parámetros en un único `engine.begin()`: ante cualquier fallo se revierte todo. IDs, `creado_en` y `permisos` se omiten del INSERT para usar SERIAL/defaults de PostgreSQL. `dispositivo_modelo` y `app_version` se omiten y quedan NULL. No se reutiliza ni modifica un tutor existente sin verificar su identidad; se devuelve conflicto.

Hash: [Argon2id mediante argon2-cffi](https://argon2-cffi.readthedocs.io/en/stable/api.html), con salt aleatorio y verificación de la biblioteca. Transacciones: [SQLAlchemy Engine.begin](https://docs.sqlalchemy.org/en/20/core/connections.html#connect-and-begin-once-from-the-engine).

## Migración sin pérdida de datos

Archivo: `backend/migrations/001_usuarios_password_hash.sql`.

```sql
ALTER TABLE public.usuarios
    ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
```

El archivo completo además aplica NOT NULL solamente si no existen filas con hash NULL. Si la columna ya existe, conserva sus valores. No cambia su tipo ni convierte posibles contraseñas antiguas: el login solo acepta hashes Argon2 válidos. Las cuentas anteriores sin hash requieren un proceso seguro de restablecimiento que todavía no existe; no se asignan contraseñas compartidas.

No se aplicó la migración a la base del usuario: la conexión falló y se eligieron pruebas aisladas. Puedes inspeccionar antes:

```sql
SELECT table_name, column_name, data_type, character_maximum_length,
       is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('usuarios', 'tutores', 'usuarios_tutores')
ORDER BY table_name, ordinal_position;
```

## Verificación en PostgreSQL

Después de registrar `ana@example.com`, ejecuta en pgAdmin/psql:

```sql
SELECT u.id_usuario, u.nombre_completo, u.email, u.telefono, u.creado_en,
       u.password_hash LIKE '$argon2id$%' AS hash_argon2id,
       t.id_tutor, t.nombre_completo AS tutor, t.email AS tutor_email,
       t.telefono AS tutor_telefono, t.creado_en AS tutor_creado_en,
       ut.relacion, ut.permisos
FROM public.usuarios u
JOIN public.usuarios_tutores ut ON ut.id_usuario = u.id_usuario
JOIN public.tutores t ON t.id_tutor = ut.id_tutor
WHERE u.email = 'ana@example.com';
```

Debe haber una fila con ambos IDs generados, timestamps, `hash_argon2id = true`, la relación indicada y `LECTURA_TOTAL`. No es necesario mostrar el hash completo.

## Pruebas manuales de errores

| Caso | Acción | Resultado esperado |
|---|---|---|
| Email usuario duplicado | Usar el correo registrado, cambiando teléfono y datos de tutor | 409, mensaje en correo, sin nuevos registros |
| Teléfono usuario duplicado | Correo nuevo y teléfono registrado, incluso con separadores | 409, mensaje en teléfono |
| Email tutor duplicado | Usuario nuevo, correo de tutor existente | 409, usuario nuevo no insertado |
| Teléfono tutor duplicado | Usuario nuevo, teléfono de tutor existente | 409, usuario nuevo no insertado |
| Contraseñas diferentes | Cambiar confirmación | Error visual; 422 si se llama directamente a la API |
| Campos vacíos | Enviar formulario vacío | Errores junto a campos; 422 en API |
| Contraseña inválida | Menos de 8 caracteres o solo espacios | Error visual; 422 en API |
| Login incorrecto | Contraseña errónea o correo inexistente | 401 con el mismo mensaje, no entra a la app |
| Escalada de privilegios | Añadir `role: "admin"` al JSON | 422, no se registra |
| Sin backend | Detener FastAPI y enviar formulario | Error de conexión; no mostrar éxito ni encolar offline |

Para validar rollback real, las pruebas automáticas provocan fallos de constraint en tutor y vínculo después de insertar usuario; verifican cero filas en las tres tablas. También verifican dos registros concurrentes: un 201 y un 409. Estos cambios de prueba solo ocurren en schemas temporales de una BD `_test`.

## Login, permisos y límites explícitos

`POST /api/auth/login` recibe `email` y `password`, verifica el hash y devuelve únicamente datos públicos de usuario y sus tutores. El frontend rellena perfil/contacto con esos datos. La verificación es real; **no se implementó sesión persistente, token, autorización de endpoints ni persistencia de ediciones del perfil**. Las APIs previas continúan con su comportamiento anterior. El registro público no puede crear administradores; la consola existente se conserva como demo claramente rotulada.

No se implementó envío de recuperación: la interfaz informa que no está disponible. No se comprobó el esquema de la BD original ni se corrigieron sus credenciales porque el usuario eligió pruebas aisladas. En ejecución el registro requiere una conexión PostgreSQL válida y el esquema indicado.

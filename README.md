# GUARDIAN CORE

Frontend móvil existente en `frontend/index.html`, FastAPI en `backend/app` y PostgreSQL. Registro real de usuario + tutor + relación en una sola transacción, y verificación de credenciales con Argon2id. Mapas, rutas, simulaciones, C5 y WebSocket conservados.

## Instalar y configurar (PowerShell, desde la raíz)

Requiere Python 3.11+ y PostgreSQL con las tablas `usuarios`, `tutores` y `usuarios_tutores` descritas en [docs/registro.md](docs/registro.md). Verificado con Python 3.14 y PostgreSQL 18.

```powershell
cd backend
# Solo si todavía no existe .venv:
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Edita `backend/.env` con tu conexión real en `DATABASE_URL`. No subas ese archivo. Los caracteres especiales de usuario/contraseña deben codificarse como URL. `GOOGLE_API_KEY` también se configura allí si usas la integración existente de Google.

La credencial anteriormente escrita en `config.py` fue rechazada por PostgreSQL durante la revisión. Se retiraron los secretos del código; **debes proporcionar una conexión válida**. No se modificó esa base: las pruebas se realizaron en PostgreSQL aislado.

## Migración explícita

El SQL compartido incluye `password_hash`, pero también se indicó que faltaba. Esta migración cubre ambos casos sin duplicar la columna:

```powershell
# Desde backend. Sustituye usuario y base si corresponde; psql pide la contraseña.
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -p 5432 -U postgres -d persistencia -W -v ON_ERROR_STOP=1 -f migrations\001_usuarios_password_hash.sql
```

También puedes ejecutar el archivo en el Query Tool de pgAdmin sobre la base correcta. No crea tablas ni se aplica automáticamente al arrancar. Si hay usuarios antiguos sin hash, conserva NULL y bloquea su login; no inventa contraseñas. Consulta las limitaciones en [docs/registro.md](docs/registro.md).

## Ejecutar backend y frontend

```powershell
# Desde backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Abre **http://localhost:8000/ui/**. FastAPI sirve el HTML existente y `auth.js`; no necesitas npm ni otro servidor. API: http://localhost:8000/docs. En móvil, misma Wi-Fi: `http://IP-DE-TU-PC:8000/ui/`. Para desplegar registro/login utiliza HTTPS.

Live Server en 5500/5501 también puede usar la API en el mismo host, puerto 8000. Añade su origen a `CORS_ORIGINS` (5500 ya incluido); para otro servidor configura el meta `guardian-api-base` de `index.html`. No abras el HTML con `file://`.

## Probar

Acceder al Sistema → Crear cuenta → completar usuario y tutor → Crear cuenta. El éxito vuelve al login con el correo rellenado. Inicia sesión con la contraseña registrada: perfil y contacto provienen de PostgreSQL. El selector Admin abre una **demo**, sin crear roles ni conceder privilegios. Recuperación de contraseña indica que aún no está disponible.

Consulta las [pruebas manuales, JSON, consultas SQL y límites](docs/registro.md).

Pruebas automatizadas contra **una base exclusiva de pruebas terminada en `_test`** con permisos para crear schemas; nunca apuntes a tu base de trabajo:

```powershell
# Desde backend
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
$env:TEST_DATABASE_URL = 'postgresql+psycopg2://USUARIO:CONTRASENA@localhost:5432/guardian_auth_test'
.\.venv\Scripts\python.exe -m pytest tests -q
# Opcional: prueba real del formulario con Chrome instalado (puerto 18080 libre).
$env:RUN_BROWSER_TESTS = '1'
.\.venv\Scripts\python.exe -m pytest tests\test_browser.py -q
```

Las pruebas crean y eliminan únicamente schemas con nombres aleatorios dentro de esa base. Cubren validaciones, los cuatro conflictos UNIQUE, hashing, login, rollback, solicitudes concurrentes, migración y WebSocket existente.

## Alcance conservado

No se encontraron manifest ni service worker en esta versión del repositorio; no se creó ni eliminó una PWA. El diseño móvil se conserva. El HTML se revalida y las respuestas de cuentas usan `Cache-Control: no-store`; el registro nunca se guarda offline.

El login verifica credenciales en PostgreSQL, pero todavía **no emite sesiones/tokens ni protege las APIs preexistentes**. Viajes y comandos siguen en memoria, y los mapas/simulaciones del frontend mantienen sus datos demo. Los cambios de contacto en el perfil siguen siendo locales. No se añadió administración, restablecimiento por correo ni asociación automática a tutores existentes.

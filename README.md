# GUARDIAN Core

React + TypeScript + Vite PWA en `frontend/`, FastAPI en `backend/app`, PostgreSQL
como fuente persistente y Redis como estado realtime/?ndice geogr?fico. Se conservan
el registro/login, telemetr?a, Risk Engine, WebSocket, comandos y ACK.

## Backend (PowerShell, desde la ra?z)

Requiere Python 3.11+, PostgreSQL con el esquema existente y Redis 6.2+.

```powershell
# Crear el entorno solo si no existe:
python -m venv backend/.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
```

Configura `DATABASE_URL`, `REDIS_URL` y `TELEMETRY_OFFLINE_TIMEOUT_SECONDS=15` en
`backend/.env`. La conexi?n de PostgreSQL solo existe en el backend.

```powershell
.\backend\.venv\Scripts\python.exe scripts\migrate.py --check
.\backend\.venv\Scripts\python.exe scripts\migrate.py
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API: http://localhost:8000/docs. Ejecutar un worker/replica: el transporte WebSocket
conserva conexiones locales; el estado de negocio s? sobrevive reinicios.

## Frontend existente

En otra terminal, desde la ra?z:

```powershell
cd frontend
npm install
npm run dev -- --host
```

Configura `VITE_API_URL` y `VITE_WS_URL` seg?n `frontend/.env.example`. Para GPS/PWA
en tel?fono usa HTTPS. El backend actual no sirve la PWA en `/ui/`.

## Persistencia y C5

[Persistencia PostgreSQL/Redis de journeys, telemetría, comandos y ACK](docs/persistencia.md).

[C5 original: DB 5, IDs CAM-* y metadata Redis existente](docs/c5.md).
C5 usa `C5_REDIS_URL=redis://localhost:6379/5`, separado de `REDIS_URL`.
El endpoint `GET /api/c5/nearest` consulta el GEOSET `acompanamiento:cdmx:c5`
y los hashes `meta:camara:{id}` sin acceder a PostgreSQL.

```powershell
# Desde la raíz: consulta de solo lectura, sin reimportar ni borrar datos.
.\backend\.venv\Scripts\python.exe scripts\c5_redis.py --latitude 19.483051 --longitude -99.073564 --limit 5
```

El importador WiFi y la persistencia PostgreSQL de C5 quedaron archivados.
La migración C5 003 no se ejecuta; las de persistencia de journeys siguen activas.

[Registro de usuario/tutor y verificaci?n de contrase?as](docs/registro.md).
La verificaci?n de credenciales existente no emite sesiones/tokens para proteger
las APIs; este bloque no agrega un sistema de autorizaci?n.

El registro detallado de pruebas distingue lo ejecutado de lo pendiente. Sin una
captura real de tel?fono no se declara probado el flujo de telemetr?a/riesgo.

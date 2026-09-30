# Persistencia de GUARDIAN Core

## Diagnóstico y decisiones

El registro/login ya utiliza SQLAlchemy Core y PostgreSQL (`usuarios`, `tutores`,
`usuarios_tutores`). Los servicios `journey_state`, `command_state` y `risk_state`
guardaban el resto del estado en diccionarios. Ahora PostgreSQL conserva los datos
y Redis contiene copias reconstruibles. `risk.py` y `frontend/` no se modificaron.

No había `DATABASE_URL` disponible en esta sesión ni Redis local activo. Por eso
no se inspeccionó ni migró la base de Railway. Las pruebas utilizaron PostgreSQL 18
y Redis 8.10.2 reales, aislados en 127.0.0.1:55432 y 127.0.0.1:56379. La base vacía
`guardian_core_test` se preparó con las definiciones de usuarios, viajes y alertas
proporcionadas por el usuario; no se crearon usuarios ni ubicaciones ficticias.

Incompatibilidades resueltas explícitamente:

- `id_viaje SERIAL` permanece como PK y mantiene las FK de alertas. Se agrega
  `journey_id UUID UNIQUE NOT NULL`, con UUID generado para viajes anteriores.
- La PWA inicia con `user_id` y admite dispositivos anónimos. Se conserva esa
  identidad en `viajes.user_id`, `telemetria.user_id` y `comandos.user_id`. Para
  cuentas numéricas se exige que exista `usuarios.id_usuario`; para dispositivos
  `id_usuario` queda NULL. Esto conserva el contrato, no crea cuentas ni otorga roles.
- Inicio no envía origen/destino/ruta/ETA. Esas columnas de viajes admiten NULL;
  el origen se completa con el primer GPS recibido. No se inventan coordenadas,
  rutas, ETA ni usuarios para satisfacer restricciones NOT NULL.
- `NUMERIC(10,8)` no representa longitudes mayores que 99.99999999 en valor absoluto.
  La migración 004 amplía las longitudes de viajes/alertas a `NUMERIC(11,8)` cuando
  hace falta. No reduce columnas que ya tengan suficiente capacidad.
- El antiguo `scripts/init_db.py` creaba otra tabla (`id`, `estado`, `ruta_esperada`)
  e insertaba una ruta ficticia. Ahora ejecuta las migraciones. Si esa tabla
  incompatible existe, 002 aborta y revierte todo: requiere inspección concreta
  antes de decidir cómo mapear sus datos.
- Los scripts C5 anteriores consultaban un proxy de terceros y usaban distintas
  combinaciones de puerto/DB. Ahora todos los consumidores usan `REDIS_URL` y
  el catálogo persistente. Las claves antiguas de DB 5 no se borran ni se importan
  automáticamente como si fueran una fuente oficial.

## Configurar y migrar

PowerShell, desde la raíz del repositorio; Python 3.11+, PostgreSQL 13+ y Redis 6.2+
con soporte GEOSEARCH. En `backend/.env`:

```dotenv
DATABASE_URL=postgresql+psycopg2://USUARIO:CONTRASENA@HOST:PUERTO/BASE
REDIS_URL=redis://HOST:PUERTO/0
TELEMETRY_OFFLINE_TIMEOUT_SECONDS=15
```

Railway también puede entregar `postgresql://`, `postgres://` o `rediss://` para
Redis TLS. No se registran DSN ni credenciales en logs. Las variables del entorno
tienen precedencia sobre `.env`.

```powershell
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\backend\.venv\Scripts\python.exe scripts\migrate.py --check
.\backend\.venv\Scripts\python.exe scripts\migrate.py
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Migraciones:

- 001 existente: se omite su SQL cuando `usuarios.password_hash` ya existe.
- 002: columnas de viajes e índices; nuevas tablas `telemetria`, `comandos`,
  `eventos_viaje`. No reemplaza `usuarios`, `viajes` ni `alertas`.
- 003: `infraestructura_c5`. Si PostGIS ya está instalado en esa base, agrega
  `location GEOGRAPHY(Point,4326)` e índice GIST. El importador mantiene location.
- 004: precisión de las columnas de longitud existentes.
- El ejecutor crea explícitamente `guardian_migrations(name, sha256, applied_at)`.
  Un bloqueo PostgreSQL serializa migraciones; el SQL y su recibo se confirman en
  una transacción. Volver a ejecutar no repite migraciones. Un archivo aplicado
  con otro checksum provoca error. No hay `DROP TABLE` ni borrado de datos.

La API conserva rutas, formatos y UUID. Las operaciones de escritura validan
actividad y propietario directamente en PostgreSQL bajo bloqueo de fila, aunque
Redis conserve una copia anterior. Fallos PostgreSQL devuelven 503; Redis caído
se registra y activa fallback. Las llamadas bloqueantes se ejecutan fuera del
event loop de FastAPI.

## Telemetría, comandos y conexión

Se conserva el cálculo de riesgo y las acciones automáticas anteriores. Un único
commit guarda el punto, cambio de riesgo, alerta relevante y comando automático;
luego se actualiza Redis y se envían `telemetry` y `command` por WebSocket en ese
orden. Así un corte entre ambos mensajes no pierde el comando: al reconectar un
journey activo se recuperan los comandos pendientes desde PostgreSQL.

Cada transición ACK queda en `eventos_viaje` como `COMMAND_ACK`, con command_id,
estado anterior/nuevo y mensaje. La tabla comandos contiene el último estado.
Reintentar el mismo ACK es idempotente; retroceder o modificar un estado terminal
devuelve 409. Se conservan las transiciones SENT, RECEIVED, EXECUTING, EXECUTED y FAILED.

Alertas solo se insertan al entrar en PRECAUTION, ALERT o CRITICAL; repetir puntos
en el mismo estado no crea alertas repetidas. El motor existente genera
EMERGENCY_MODE en CRITICAL; no se introduce otro estado de riesgo.

`last_telemetry_at` usa la hora de recepción del servidor. `online` pasa a false
al consultar el viaje o al recibir otro paquete tras superar el timeout. Se
registran CONNECTION_LOST/RESTORED al detectar esas transiciones; no hay un daemon
de detección ni una promesa de evento exactamente al segundo 15. La ubicación
reciente se elige por timestamp de adquisición para evitar que un paquete offline
antiguo reemplace un punto GPS más nuevo. El riesgo mantiene el orden de recepción
del flujo existente.

## Redis

| Clave | Tipo/contenido |
| --- | --- |
| `guardian:journey:{uuid}:state` | JSON: journey_id, user_id, status, started_at, ended_at, last_telemetry_at, online, updated_at |
| `guardian:journey:{uuid}:location` | JSON: latitude, longitude, accuracy, timestamp, updated_at |
| `guardian:journey:{uuid}:risk` | JSON: status, score, reasons, updated_at |
| `guardian:command:{uuid}` | JSON del comando y último ACK |
| `guardian:journey:{uuid}:pending_commands` | SET de command_id no terminales |
| `guardian:c5:geo` | GEOSET de infraestructura |
| `guardian:c5:meta:{id}` | HASH, campo `data` con JSON del registro y metadata original |
| `guardian:c5:version` | Conteo/fecha de PostgreSQL del índice construido |
| `guardian:c5:geo:build:{uuid}` | Clave temporal durante reconstrucción, TTL 600 s |

Las copias realtime tienen TTL de 30 s y versión para evitar sobrescrituras por
workers retrasados. Una copia anterior puede verse hasta vencer el TTL si falló
su actualización; nunca autoriza escrituras: estas se verifican en PostgreSQL.
La lectura tras vencimiento reconstruye estado, riesgo, ubicación y pendientes.
C5 no depende de TTL: coteja versión/conteo contra PostgreSQL y reconstruye el GEOSET
cuando falta. La publicación del índice completo es atómica. Redis caído usa una
consulta geográfica parametrizada en PostgreSQL.

Se mantiene un proceso/replica para WebSocket, como en el despliegue actual.
Solo los objetos de conexiones abiertas permanecen en RAM; no son datos de
negocio persistibles. El fan-out WebSocket entre réplicas requiere Pub/Sub y no
se añadió. No configurar varios workers esperando entrega de mensajes entre ellos.

## C5 real

El archivo verificado es [WiFi gratuito en Postes del C5, julio 2025](https://datos.cdmx.gob.mx/dataset/d5410ea3-dbdd-437d-9def-91f30ec9a390/resource/9bb1debb-15e9-4d48-baec-07c9edd87a23/download/9bb1debb-15e9-4d48-baec-07c9edd87a23.xlsx).
Contiene 13,714 filas y columnas `id`, `programa`, `latitud`, `longitud`, `alcaldia`.
SHA-256 del archivo descargado para esta verificación:
`733e6219a9761a1dabed9208639c483a8938e6ab51154a56be136019383cfa8a`.
Es infraestructura con WiFi; no demuestra que cada punto sea una cámara o un refugio
atendido. Dirección/esquina/colonia/poste/botón/altavoz quedan NULL cuando faltan;
`metadata` conserva exactamente las propiedades originales.

```powershell
# Desde la raíz; usa el mismo --source al repetir una importación.
Invoke-WebRequest -Uri 'https://datos.cdmx.gob.mx/dataset/d5410ea3-dbdd-437d-9def-91f30ec9a390/resource/9bb1debb-15e9-4d48-baec-07c9edd87a23/download/9bb1debb-15e9-4d48-baec-07c9edd87a23.xlsx' -OutFile "$env:TEMP\guardian-c5.xlsx"
.\backend\.venv\Scripts\python.exe scripts\import_c5.py "$env:TEMP\guardian-c5.xlsx" --source 'https://datos.cdmx.gob.mx/dataset/wifi-gratuito-en-postes-del-c5'
# Reconstrucción sin descargar de nuevo:
.\backend\.venv\Scripts\python.exe scripts\import_c5.py --rebuild-redis
```

También admite CSV y GeoJSON Point; `--encoding cp1252` permite CSV de otra
codificación. XLSX utiliza openpyxl, la única nueva dependencia. Los IDs se toman
de la fuente, nunca de un contador inventado. Un ID atribuido a otra fuente aborta
la transacción; no reemplaza su procedencia silenciosamente. No elimina registros
ausentes de un archivo posterior. Importaciones/reconstrucciones se serializan.
Si falla Redis después del commit, el script termina con código 2 y permite
reconstruir luego; PostgreSQL conserva el catálogo completo.

Endpoint nuevo: `GET /api/c5/nearest?latitude=...&longitude=...&radius_m=1000`.
Devuelve `encontrado`, `id_poste`, `distancia_metros` y `metadata`; las coordenadas
de la consulta deben provenir del teléfono o de un registro real. Redis calcula
distancia sobre esfera; la consulta PostgreSQL de fallback también. No son rutas
peatonales ni distancias de viaje.

## Verificación realizada y límites

Ejecutado el 29/09/2026 en servicios reales aislados:

- Migración del esquema documentado, y segunda ejecución sin volver a aplicar.
- Inicio por HTTP y existencia en PostgreSQL/Redis.
- Comando por HTTP y recepción por WebSocket real.
- ACK RECEIVED, EXECUTING y EXECUTED, comprobados en PostgreSQL/Redis/WebSocket;
  tres eventos históricos, repetición idempotente y rechazo de regresión.
- Reinicio del proceso Uvicorn con journey activo y reenvío del comando pendiente.
- Finalización persistente, nuevo reinicio y borrado de las claves de prueba;
  recuperación del journey completado y comando EXECUTED desde PostgreSQL.
- Redis realmente detenido: inicio, comando, tres ACK, finalización/consulta y
  búsqueda C5 siguieron funcionando mediante PostgreSQL.
- Fallo real de una restricción PostgreSQL en COMMAND_SENT: HTTP 503 y rollback
  del comando junto con su evento; no quedó una inserción parcial.
- UUID inválido (404), telemetría vacía (422), propietario incorrecto (403),
  comando después de finalizar (409) y cierre repetido sin duplicar el evento.
- Importación oficial: procesados 13,714; insertados 13,714; actualizados 0;
  inválidos 0. Segunda importación: insertados 0, actualizados 13,714, inválidos 0.
- Conteo idéntico en PostgreSQL y GEOSET. Consulta en coordenadas de la fuente:
  infraestructura a menos de 1 m, dentro de la cuantización GEO de Redis.
- Borrado exclusivo de `guardian:c5:*` en Redis de prueba y reconstrucción de los
  13,714 registros desde PostgreSQL; nueva búsqueda exitosa.

No se recibió captura GPS del teléfono. **No se ejecutaron envíos de telemetría,
transiciones del Risk Engine, inserción de alertas ni timeout de conexión con GPS
real.** No se sustituyeron por coordenadas inventadas o puntos C5 presentados como
ubicación de una persona. La rama PostGIS no se ejecutó: la extensión no estaba
instalada. No se migró Railway ni se hizo una prueba de campo del frontend.

El verificador no genera sensores ni personas: usa una identidad anónima de la
máquina que lo ejecuta. Registra trayectos y comandos reales de esa sesión de
verificación en la base aislada, sin insertar usuarios. Requiere una base migrada
terminada en `_test` y un Redis exclusivo para pruebas:

```powershell
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
$env:DATABASE_URL='postgresql+psycopg2://USUARIO:CONTRASENA@HOST:PUERTO/guardian_core_test'
$env:REDIS_URL='redis://HOST_REDIS_PRUEBA:PUERTO/0'
.\backend\.venv\Scripts\python.exe scripts\verify_persistence.py --clear-c5-cache
# Para cubrir telemetría, exportar una captura real como un array JSON de paquetes:
.\backend\.venv\Scripts\python.exe scripts\verify_persistence.py --telemetry-file 'C:\ruta\captura-real.json' --clear-c5-cache
```

El verificador solo cambia journey_id/user_id de la captura para asociarla al
journey creado. No altera GPS, sensores ni condiciones de red. Para verificar
varios niveles de riesgo se necesita una captura que realmente los produzca.
Resultados y logs locales: `.tools/persistence-results.json` y
`.tools/persistence-backend.log`; no se suben al repositorio.

La prueba pytest antigua de journey se adaptó para exigir `REAL_TELEMETRY_FILE`,
`TEST_DATABASE_URL` migrada y `TEST_REDIS_URL`: ya no envía un GPS ficticio ni puede
usar accidentalmente DATABASE_URL de producción. Ejecutada sin captura: **1 skipped**,
no un test aprobado. La suite antigua de autenticación con personas ficticias no
se ejecutó en este bloque.

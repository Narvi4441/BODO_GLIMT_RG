# GUARDIAN Core · PWA

Migración del HTML/JS existente a React + TypeScript + Vite + vite-plugin-pwa. Solo se modificó `frontend/`. El código anterior se conserva íntegro en `legacy/index.html` y `legacy/auth.js` como referencia; no se incorpora al build ni a la caché offline.

## Ejecutar en PowerShell

Requiere Node.js 22.12+ y el backend FastAPI existente activo. Desde la raíz del repositorio:

```powershell
cd frontend
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm install
npm run dev -- --host
```

Abre http://localhost:5173. Si PowerShell bloquea `npm.ps1`, utiliza `npm.cmd` en los mismos comandos; no es necesario cambiar ExecutionPolicy.

```powershell
npm run build
npm run preview -- --host
```

Preview: http://localhost:4173. **El service worker y el offline shell se verifican con build + preview**, no en `npm run dev`. Evita cambiar de versión durante un trayecto: el aviso de actualización espera a que termine.

Ya no se abre el nuevo frontend directamente con `file://` ni con el antiguo `/ui/` de FastAPI: el código TypeScript necesita Vite/build. El backend y sus rutas no se modificaron. Para producción publica `dist/` bajo HTTPS y configura proxy `/api` y `/ws`, o las URLs externas indicadas abajo.

## Conectar con FastAPI

`.env` por defecto:

```dotenv
VITE_API_URL=
VITE_WS_URL=/ws
API_PROXY_TARGET=http://127.0.0.1:8000
```

El cliente usa el mismo origen de la PWA. Vite y preview reenvían `/api` y `/ws` al backend. Funciona también por IP LAN sin editar CORS del backend. `API_PROXY_TARGET` es configuración del servidor de desarrollo, no una URL hardcodeada en el cliente.

Si utilizas servidores separados:

```dotenv
VITE_API_URL=https://api.tu-dominio.com
VITE_WS_URL=wss://api.tu-dominio.com/ws
```

`VITE_API_URL` no incluye `/api`; `VITE_WS_URL` termina en `/ws`, la app añade `/journeys/{journey_id}`. Reinicia Vite o recompila tras cambiar variables. Todas las variables `VITE_` son públicas: nunca pongas contraseñas, tokens privados ni credenciales PostgreSQL. Un despliegue separado necesita el origen permitido en la configuración existente del backend; el proxy evita ese requisito en desarrollo.

## Teléfono en la misma red: HTTPS real

HTTP por IP permite ver la interfaz, pero no habilita GPS/service worker/instalación. El permiso de ubicación y las PWA necesitan un contexto seguro. No basta con aceptar una advertencia de certificado autofirmado. [Contextos seguros y service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

Una opción local es `mkcert` con un certificado que el PC **y el teléfono** confíen. Si ya tienes un certificado válido para tu IP, usa sus rutas directamente.

```powershell
# Opcional, instalar mkcert si no existe:
winget install --id FiloSottile.mkcert -e
# Reabre PowerShell después de instalar. Desde frontend:
mkcert -install
ipconfig
# Sustituye 192.168.1.50 por la IPv4 de tu conexión Wi-Fi:
New-Item -ItemType Directory -Force certs
mkcert -cert-file certs/guardian.pem -key-file certs/guardian-key.pem localhost 127.0.0.1 192.168.1.50
mkcert -CAROOT
```

Transfiere al teléfono **solo `rootCA.pem`** de la carpeta indicada por `mkcert -CAROOT` e instálalo como certificado CA confiable. Nunca compartas `rootCA-key.pem` ni `guardian-key.pem`. En iPhone instala el perfil y habilita confianza completa en Ajustes → General → Información → Ajustes de confianza de certificados. En Android instala el certificado CA desde la configuración de seguridad (la ruta depende del fabricante).

Añade a `frontend/.env`:

```dotenv
DEV_HTTPS_CERT=certs/guardian.pem
DEV_HTTPS_KEY=certs/guardian-key.pem
```

```powershell
npm run build
npm run preview -- --host
```

Desde el teléfono, misma Wi-Fi, abre **https://192.168.1.50:4173**. Permite Node/puerto 4173 en el firewall para la red privada si Windows lo solicita. API HTTP y WebSocket del backend quedan detrás del proxy HTTPS/WSS de Vite, sin contenido mixto.

- Android/Chrome: botón Instalar cuando el navegador lo ofrezca, o menú → Instalar aplicación.
- iPhone/Safari: Compartir → Añadir a pantalla de inicio.
- Desarrollo con recarga: `npm run dev -- --host`, https://IP:5173, sin offline shell.

También puedes desplegar `dist/` y un proxy bajo un dominio HTTPS confiable. No se añade ningún servicio externo como dependencia de la aplicación.

## Funcionamiento y contratos respetados

1. Inicio con un identificador local `device-UUID`, claramente rotulado como dispositivo sin sesión, o con `id_usuario` del login real ya existente. El backend permite `user_id` de tipo string. No se simula autenticación.
2. Solicitar ubicación real; si se deniega no se crea un viaje. Después `POST /api/journeys/start`, guardar ID y sesión del trayecto en IndexedDB.
3. Cada 5 s solicitar un punto GPS fresco (`getCurrentPosition`, sin solapar solicitudes). Guardarlo primero en IndexedDB y enviarlo por `POST /api/telemetry`.
4. WebSocket nativo por `/ws/journeys/{id}` recibe telemetry/command/command_ack. Reconexión progresiva de 1 a 10 s. Los comandos automáticos incluidos en la respuesta HTTP también se procesan, evitando duplicados por `command_id`.
5. SET_TELEMETRY_RATE aplica segundos (1–60) al temporizador. REQUEST_CHECK_IN espera una respuesta humana antes de EXECUTED. EMERGENCY_MODE activa indicador crítico e intervalo de 1 s. Acciones desconocidas/rangos inválidos generan FAILED. RECEIVED/EXECUTING/EXECUTED/FAILED se envían al endpoint existente de ACK.
6. “Necesito ayuda” se comunica en el mensaje del ACK y activa emergencia local. No inventa un endpoint SOS ni afirma avisar a servicios de emergencia.
7. Al finalizar se detiene el temporizador GPS, se ignoran callbacks GPS tardíos, se cierra WebSocket y se limpia la vista realtime. Primero se vacía la cola y luego se llama a `/stop`. Si estás offline, esa intención de cierre se guarda y se completa al reconectar; **los datos se conservan incluso tras recargar**.

La interfaz muestra el riesgo/score calculado por el backend. El estado crítico local de emergencia se identifica aparte y no altera ni inventa el score.

## Sensores y red

- Latitud/longitud/precisión/velocidad/rumbo/timestamp provienen de Geolocation API. Velocidad se envía en m/s y se muestra en km/h.
- Batería solo si existe Battery Status API; Safari normalmente no la expone. Se envía null si falta.
- `latency_ms`: duración de la última solicitud de telemetría confirmada, no estimación ficticia.
- `packet_loss: null`: HTTP no permite medir pérdidas de paquetes IP de forma fiable.
- `route_deviation_m: null`: no hay una ruta oficial disponible para calcularlo en este contrato.
- ONLINE: red disponible sin fallos conocidos; DEGRADED: falla HTTP o reconexión WebSocket; OFFLINE: `navigator.onLine === false`. ONLINE por sí solo no garantiza que el backend esté disponible.
- No hay GPS garantizado con la pantalla bloqueada o en segundo plano. El SO puede suspender JS y los sensores. Mantén la PWA visible. El intervalo indica cuándo se solicita un punto; la velocidad de obtención depende del GPS.
- El registro/login existente se migró y requiere conexión. El registro mantiene el tutor porque el backend existente lo exige; no se implementó un sistema nuevo de contactos. La recuperación por correo continúa marcada como no disponible. El backend actual no emite sesiones/tokens.

## Offline sin falsas confirmaciones

IndexedDB conserva puntos y ACK en una cola FIFO. Solo se elimina cada entrada tras una respuesta exitosa. Al reconectar se drena en orden, se muestra la cantidad de puntos recuperados y se reintenta cada 5 s mientras la app esté abierta. El service worker solo cachea archivos de interfaz; nunca cuentas, respuestas de API ni POST. No hay background sync ni promesas de transmisión con la app cerrada.

Si falla el almacenamiento, se pausa GPS y se informa: cualquier punto ya adquirido que no pudo persistirse permanece en memoria mientras no cierres la página. Hay exportación JSON de los pendientes; la exportación no borra datos. Usa una sola pestaña/instancia durante cada trayecto.

**Límites del backend existente:** viajes/comandos están en memoria y desaparecen al reiniciar Python. Además, el backend rechaza telemetría de viajes terminados. Ante 404/409, la cola se conserva y muestra el error; el frontend no puede recuperar esos viajes ni forzar su aceptación sin cambios del backend. Si el servidor recibió un punto pero se perdió la respuesta, puede reenviarse: entrega al menos una vez, porque no hay claves de idempotencia en el contrato actual.

## Verificar

```powershell
npm test
# Chrome instalado y backend/.venv con sus dependencias existentes:
npm run test:e2e
```

Las pruebas E2E arrancan una instancia temporal de FastAPI en 18081 con `-B` (sin escribir bytecode) y el frontend compilado en 4173; no modifican Python ni usan PostgreSQL. Usan geolocalización controlada en Chrome únicamente para la prueba, API/WS reales e IndexedDB real. Cubren:

- Crear viaje, telemetría inicial a 5 s y cambio efectivo a 1 s.
- Teleproceso automático del Risk Engine, check-in y emergencia con ACK.
- Guardado offline, reenvío ordenado, cierre offline y recarga de la interfaz offline.
- Ausencia de envíos nuevos tras finalizar y diseño móvil.

Para una prueba manual desde `/docs` del backend, toma `journey_id` de la pantalla e identifica su `user_id` con GET `/api/journeys/{id}`. Envía POST `/api/commands` con esos IDs, `action: "SET_TELEMETRY_RATE"` y `value: 1`. Observa el intervalo y ACK. Después prueba REQUEST_CHECK_IN y EMERGENCY_MODE. Desconecta la red durante el trayecto: deben crecer los pendientes; reconecta y observa la recuperación.

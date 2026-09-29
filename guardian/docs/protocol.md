# Protocolo del MVP

Broker local TCP `127.0.0.1:1883`, MQTT 3.1.1, QoS 1, mensajes JSON sin retain.

| Topic | Emisor → receptor |
| --- | --- |
| guardian/NODE-A/telemetry | Nodo → FastAPI |
| guardian/NODE-A/command | FastAPI → Nodo |
| guardian/NODE-A/ack | Nodo → FastAPI |

FastAPI entrega snapshots por `/ws`, recibe instrucciones por `POST /api/commands` y expone `/api/health` y `/docs`. Vite reenvía API y WebSocket al backend; el móvil usa el mismo host que la interfaz.

Cada comando tiene UUID, nombre y hora. SET_TELEMETRY_RATE incluye `interval_seconds` (0.5–10 s). El ACK correlaciona UUID y nombre, incluye estado EXECUTED/REJECTED, mensaje y hora. La API devuelve 202 al publicar; únicamente el ACK confirma ejecución. Después de 8 s sin ACK se muestra TIMEOUT; un ACK tardío actualiza ese estado. Se conservan 30 comandos en memoria. El nodo evita repetir los últimos 100 comandos por UUID.

La telemetría incluye coordenadas, km/h, m/s², batería %, latencia sintética ms (no medición de RTT), desviación m, modo de emergencia, intervalo y secuencia. Todo dato de sensor es simulado. El check-in es una respuesta automática del simulador.

Riesgo: gana la regla de mayor severidad. NORMAL sin reglas activas; PRECAUTION con desviación ≥30 m, batería ≤25% o latencia ≥300 ms; ALERT con desviación ≥100 m, aceleración absoluta ≥4 m/s² o batería ≤10%; CRITICAL con desviación ≥250 m o emergencia. El nodo cambia desviación 8/45/140/280 m cada 20 s para demostrar los cuatro estados. NORMAL_MODE desactiva emergencia, pero no anula las reglas de sensores.

Sin datos durante max(5 s, 3 × intervalo), la UI indica SIN SEÑAL y desactiva comandos. Broker y backend desconectados también desactivan controles. Sin persistencia: SQLite queda para después. PWA con manifest y service worker sin caché, sin offline. El demo local no tiene autenticación.

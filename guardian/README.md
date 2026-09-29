# GUARDIAN

MVP local: NODE-A → MQTT → FastAPI → WebSocket → React, con comandos y ACK de regreso. Python 3.11–3.13 y Node.js 22 LTS. Sin Docker ni servicios externos en ejecución.

## Instalar (PowerShell, desde la raíz del repositorio)

```powershell
cd guardian
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
cd frontend
npm.cmd install
cd ..
```

Si Node.js no está instalado, instala Node.js 22 LTS y vuelve a abrir la terminal. No es necesario activar el entorno virtual ni modificar ExecutionPolicy. `npm.cmd` es el equivalente de `npm` que funciona con la política predeterminada de PowerShell.

## Ejecutar

Abre cuatro terminales de VS Code, todas inicialmente en `guardian`:

```powershell
# Terminal 1: broker MQTT
.\.venv\Scripts\python.exe -m backend.broker
```
```powershell
# Terminal 2: API
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```
```powershell
# Terminal 3: dispositivo
.\.venv\Scripts\python.exe nodes\node_a.py
```
```powershell
# Terminal 4: interfaz
cd frontend
npm.cmd run dev
```

Abre http://localhost:5173. Detén cada proceso con Ctrl+C.

## Comprobar

1. Debe aparecer NODE-A EN LÍNEA y métricas cambiando. El ciclo simulado pasa por NORMAL, PRECAUTION, ALERT y CRITICAL cada 20 s.
2. Aplica 0.5 s: espera ACK y el intervalo aplicado debe cambiar. Solicita check-in: aparece la confirmación automática.
3. Activa emergencia: ACK y CRITICAL. Restaura modo normal: ACK y riesgo según sensores.
4. Detén NODE-A: tras max(5 s, 3 × intervalo) aparece SIN SEÑAL y controles desactivados.

Prueba automática con los tres procesos Python activos:
```powershell
.\.venv\Scripts\python.exe docs\verify.py
```

Compilación de React/TypeScript:
```powershell
cd frontend
npm.cmd run build
npm.cmd run preview
```

Móvil: misma Wi-Fi, abre `http://IP-DE-TU-PC:5173` (consulta `ipconfig`); permite el puerto 5173 en el firewall si Windows lo solicita. El diseño es responsive. La instalación PWA requiere contexto seguro: localhost en PC o HTTPS en móvil; HTTP por IP permite visualizar, pero no instalar. No hay caché offline. Manifest e iconos locales incluidos.

Arquitectura y reglas: [docs/protocol.md](docs/protocol.md). Datos y comandos viven solo en memoria; SQLite se incorporará posteriormente.

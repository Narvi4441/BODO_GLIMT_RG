"""NODE-A: sensores sintéticos y ejecución real de teleprocesos MQTT."""
import json
import math
import threading
import time
import paho.mqtt.client as mqtt

TOPIC = "guardian/NODE-A"


def main():
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="guardian-node-a")
    lock = threading.Lock()
    wake = threading.Event()
    state = {"interval": 1.0, "emergency": False}
    executed = {}
    started = time.monotonic()

    def on_connect(client, userdata, flags, reason, properties):
        if not reason.is_failure:
            client.subscribe(f"{TOPIC}/command", qos=1)
            print("NODE-A conectado al broker", flush=True)

    def on_message(client, userdata, message):
        try:
            data = json.loads(message.payload)
            command_id = data["command_id"]
            command = data["command"]
            if command_id in executed:
                client.publish(f"{TOPIC}/ack", executed[command_id], qos=1)
                return
            status, detail = "EXECUTED", ""
            with lock:
                if command == "SET_TELEMETRY_RATE":
                    interval = float(data["interval_seconds"])
                    if not 0.5 <= interval <= 10:
                        raise ValueError("Intervalo fuera de rango")
                    state["interval"] = interval
                    detail = f"Intervalo aplicado: {interval:g} s"
                elif command == "REQUEST_CHECK_IN":
                    detail = "Check-in automático confirmado por NODE-A simulado"
                elif command == "EMERGENCY_MODE":
                    state["emergency"] = True
                    detail = "Modo de emergencia activado"
                elif command == "NORMAL_MODE":
                    state["emergency"] = False
                    detail = "Modo normal restaurado; continúa evaluación de sensores"
                else:
                    status, detail = "REJECTED", "Comando desconocido"
            ack = json.dumps({"node_id": "NODE-A", "command_id": command_id, "command": command,
                              "status": status, "message": detail, "timestamp": time.time()})
            executed[command_id] = ack
            if len(executed) > 100:
                del executed[next(iter(executed))]
            client.publish(f"{TOPIC}/ack", ack, qos=1, retain=False)
            wake.set()
            print(f"ACK {command}: {detail}", flush=True)
        except (ValueError, KeyError, TypeError):
            print("Comando inválido descartado", flush=True)

    client.on_connect = on_connect
    client.on_message = on_message
    client.connect_async("127.0.0.1", 1883, 30)
    client.loop_start()
    sequence = 0
    try:
        while True:
            elapsed = time.monotonic() - started
            with lock:
                interval, emergency = state["interval"], state["emergency"]
            if client.is_connected():
                sequence += 1
                # Ciclo de demostración de 80 s: normal, precaución, alerta, crítico.
                deviation = [8, 45, 140, 280][int(elapsed // 20) % 4]
                data = {"node_id": "NODE-A", "timestamp": time.time(), "sequence": sequence,
                        "latitude": round(19.4326 + math.sin(elapsed / 100) * 0.002, 6),
                        "longitude": round(-99.1332 + math.cos(elapsed / 100) * 0.002, 6),
                        "speed_kmh": round(4.8 + math.sin(elapsed / 5) * 1.2, 1),
                        "acceleration_ms2": round(math.cos(elapsed / 5) * 0.067, 3),
                        "battery_percent": round(max(5, 96 - elapsed / 300), 1),
                        "latency_ms": round(35 + abs(math.sin(elapsed)) * 45),
                        "route_deviation_m": deviation, "emergency": emergency,
                        "interval_seconds": interval}
                client.publish(f"{TOPIC}/telemetry", json.dumps(data), qos=1, retain=False)
            wake.wait(interval)
            wake.clear()
    except KeyboardInterrupt:
        pass
    finally:
        client.disconnect()
        client.loop_stop()


if __name__ == "__main__":
    main()

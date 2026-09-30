from sqlalchemy import text, create_engine
from app.core.config import Config
import redis
import requests
from app.core.cache import get_redis
from app.core.database import get_engine

def probar_conexiones():
    print("--- INICIANDO DIAGNÓSTICO DEL SISTEMA GUARDIÁN ---\n")

    # 1. Prueba PostgreSQL (Conexión directa)
    try:
        engine = get_engine()
        with engine.connect() as conexion:
            conexion.execute(text("SELECT 1"))
        print("✅ PostgreSQL: Conexión exitosa a la base de datos.")
    except Exception as e:
        print(f"❌ PostgreSQL Error: No se pudo conectar.\nDetalle: {e}")

    # 2. Prueba Redis
    try:
        r = get_redis()
        if r.ping():
            print("✅ Redis: Conexión exitosa mediante REDIS_URL.")
            total_camaras = r.zcard("guardian:c5:geo")
            print(f"   -> Nodos C5 indexados en memoria: {total_camaras}")
    except Exception as e:
        print(f"❌ Redis Error: El contenedor no está respondiendo.\nDetalle: {e}")

    # 3. Prueba Google Routes API
    try:
        url = "https://routes.googleapis.com/directions/v2:computeRoutes"
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": Config.GOOGLE_API_KEY,
            "X-Goog-FieldMask": "routes.distanceMeters"
        }
        # Coordenadas de prueba (Zócalo CDMX al Ángel de la Independencia)
        payload = {
            "origin": {"location": {"latLng": {"latitude": 19.4326, "longitude": -99.1332}}},
            "destination": {"location": {"latLng": {"latitude": 19.4270, "longitude": -99.1676}}}
        }
        
        res = requests.post(url, json=payload, headers=headers)
        if res.status_code == 200:
            print("✅ Google Maps: API Key válida y facturación activa. Cálculo de rutas funcionando.")
        else:
            print(f"❌ Google Maps Error HTTP {res.status_code}: {res.text}")
            if res.status_code == 403:
                print("   -> Posible causa: La facturación de Google Cloud no está activa o la API Key no tiene permisos.")
    except Exception as e:
        print(f"❌ Google Maps Error: Falló la petición.\nDetalle: {e}")

if __name__ == "__main__":
    probar_conexiones()

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

class Config:
    # Conexión a PostgreSQL
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", "")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # Conexión a Redis
    REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
    REDIS_PORT = int(os.getenv("REDIS_PORT", "6380"))
    REDIS_URL = os.getenv("REDIS_URL", f"redis://{REDIS_HOST}:{REDIS_PORT}/0")
    # C5 conserva su Redis original; no comparte la configuración de estado realtime.
    C5_REDIS_URL = os.getenv("C5_REDIS_URL", "redis://localhost:6379/5")
    TELEMETRY_OFFLINE_TIMEOUT_SECONDS = max(1, int(os.getenv("TELEMETRY_OFFLINE_TIMEOUT_SECONDS", "15")))
    
    # Aquí va la llave
    GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
    CORS_ORIGINS = [origin.strip() for origin in os.getenv(
        "CORS_ORIGINS",
        "https://bodo-glimt-rg.vercel.app,"
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:4173,http://127.0.0.1:4173,"
        "http://localhost:8000,http://127.0.0.1:8000,http://localhost:5500,http://127.0.0.1:5500"
    ).split(",") if origin.strip()]

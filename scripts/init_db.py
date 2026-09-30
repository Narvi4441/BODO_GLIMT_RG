import json
from sqlalchemy import text
from backend.app.core.database import get_engine

def preparar_base_de_datos():
    engine = get_engine()
    
    with engine.connect() as conn:
        print("Creando tabla de viajes...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS viajes (
                id SERIAL PRIMARY KEY,
                estado VARCHAR(50) DEFAULT 'activo',
                ruta_esperada JSONB NOT NULL
            );
        """))
        
        print("Insertando viaje de prueba...")
        ruta_prueba = [
            {"lat": 19.4850, "lon": -99.1020},
            {"lat": 19.4860, "lon": -99.1020}  # Una línea recta de un par de cuadras
        ]
        
        conn.execute(text("""
            INSERT INTO viajes (estado, ruta_esperada) 
            VALUES ('activo', :ruta)
        """), {"ruta": json.dumps(ruta_prueba)})
        
        conn.commit() # Obligatorio en SQLAlchemy 2.0+
        print("✅ Base de datos lista en PostgreSQL. Viaje ID: 1 creado.")

if __name__ == "__main__":
    preparar_base_de_datos()
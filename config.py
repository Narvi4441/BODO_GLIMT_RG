import os

class Config:

    SQLALCHEMY_DATABASE_URI = 'postgresql://postgres:TU_CONTRASEÑA@localhost:5432/persistencia'
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # Conexión a Redis
    REDIS_HOST = 'localhost'
    REDIS_PORT = 6380
    
    # Google Maps
    GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY', 'TU_CLAVE_AQUI')
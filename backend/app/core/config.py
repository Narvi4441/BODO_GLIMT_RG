import os

class Config:
    # Conexión a PostgreSQL
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL', 'postgresql://postgres:TU_CONTRASEÑA_REAL@localhost:5432/persistencia')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # Conexión a Redis
    REDIS_HOST = 'localhost'
    REDIS_PORT = 6380
    
    # Aquí va la llave
    GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY', 'AIzaSyD51LNm1X0LmeeAXzB1c7KpEUHwIByuVeY')
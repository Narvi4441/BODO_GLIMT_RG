import os

class Config:
    # Conexión a PostgreSQL
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL', 'postgresql+psycopg2://postgres:Gaufred1596@localhost:5432/persistencia')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # Conexión a Redis
    REDIS_HOST = 'localhost'
    REDIS_PORT = 6379
    
    # Aquí va la llave
    GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY', 'AIzaSyD51LNm1X0LmeeAXzB1c7KpEUHwIByuVeY')
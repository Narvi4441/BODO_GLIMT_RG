import requests
import pandas as pd
import redis
import time


r = redis.Redis(host='localhost', port=6379, db=5, decode_responses=True)
REDIS_GEO_KEY = "acompanamiento:cdmx:c5"

def extraer_datos_c5_api():
    url_base = "https://datos.cdmx.gob.mx/api/3/action/datastore_search"
    resource_id = "53b6a31e-6fd0-4a72-aca9-b8a703789a81"
    registros_totales = []
    limit = 10000
    offset = 0
    
    print("Extrayendo desde la API del C5...")
    while True:
        respuesta = requests.get(url_base, params={"resource_id": resource_id, "limit": limit, "offset": offset})
        if respuesta.status_code != 200: break
        registros = respuesta.json().get("result", {}).get("records", [])
        if not registros: break
            
        registros_totales.extend(registros)
        offset += limit
        time.sleep(0.5)
        
    df = pd.DataFrame(registros_totales)
    df['latitud'] = pd.to_numeric(df['latitud'], errors='coerce')
    df['longitud'] = pd.to_numeric(df['longitud'], errors='coerce')
    return df.dropna(subset=['latitud', 'longitud'])

def indexar_camaras_en_redis(df_c5):
    print(f"Indexando {len(df_c5)} cámaras en Redis...")
    pipe = r.pipeline()
    lote_coordenadas = {}
    
    for indice, fila in df_c5.iterrows():
        id_poste = str(fila.get('id_poste', f'C5_UNKN_{indice}'))
        lote_coordenadas[id_poste] = (float(fila['longitud']), float(fila['latitud']))
        
        if len(lote_coordenadas) >= 2000:
            pipe.geoadd(REDIS_GEO_KEY, lote_coordenadas)
            lote_coordenadas = {}
            
    if lote_coordenadas:
        pipe.geoadd(REDIS_GEO_KEY, lote_coordenadas)
    pipe.execute()
    print("Indexación completada exitosamente.")

if __name__ == "__main__":
    df = extraer_datos_c5_api()
    indexar_camaras_en_redis(df)


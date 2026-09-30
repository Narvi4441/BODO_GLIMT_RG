import requests
import json
import redis

# Conexión a Redis
r = redis.Redis(host='localhost', port=6379, db=5, decode_responses=True)
REDIS_GEO_KEY = "acompanamiento:cdmx:c5"

# 1. Pega aquí las Request URL completas que sacaste de tu pestaña Network
URLS_MANUALES = [
    "https://geoportal.mapoteca.com.mx/proxy/wms/1?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&FORMAT=image%2Fpng&TRANSPARENT=true&QUERY_LAYERS=c5_camaras_videovigilancia&TILED=true&TILESORIGIN=-180%2C-90&LAYERS=c5_camaras_videovigilancia&INFO_FORMAT=application%2Fjson&feature_count=100&I=230&J=203&WIDTH=256&HEIGHT=256&CRS=EPSG%3A3857&BBOX=-11036283.891926888%2C2211170.354233578%2C-11031391.922116637%2C2216062.324043829",
    "https://geoportal.mapoteca.com.mx/proxy/wms/1?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&FORMAT=image%2Fpng&TRANSPARENT=true&QUERY_LAYERS=c5_camaras_videovigilancia&TILED=true&TILESORIGIN=-180%2C-90&LAYERS=c5_camaras_videovigilancia&INFO_FORMAT=application%2Fjson&feature_count=100&I=237&J=72&WIDTH=256&HEIGHT=256&CRS=EPSG%3A3857&BBOX=-11046067.83154739%2C2211170.354233578%2C-11036283.891926888%2C2220954.2938540806",
    "https://geoportal.mapoteca.com.mx/proxy/wms/1?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&FORMAT=image%2Fpng&TRANSPARENT=true&QUERY_LAYERS=c5_camaras_videovigilancia&TILED=true&TILESORIGIN=-180%2C-90&LAYERS=c5_camaras_videovigilancia&INFO_FORMAT=application%2Fjson&feature_count=100&I=59&J=183&WIDTH=256&HEIGHT=256&CRS=EPSG%3A3857&BBOX=-11036283.891926888%2C2211170.354233578%2C-11026499.952306386%2C2220954.2938540806",
    "https://geoportal.mapoteca.com.mx/proxy/wms/1?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&FORMAT=image%2Fpng&TRANSPARENT=true&QUERY_LAYERS=c5_camaras_videovigilancia&TILED=true&TILESORIGIN=-180%2C-90&LAYERS=c5_camaras_videovigilancia&INFO_FORMAT=application%2Fjson&feature_count=100&I=253&J=217&WIDTH=256&HEIGHT=256&CRS=EPSG%3A3857&BBOX=-11046067.83154739%2C2211170.354233578%2C-11036283.891926888%2C2220954.2938540806",
    "https://geoportal.mapoteca.com.mx/proxy/wms/1?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&FORMAT=image%2Fpng&TRANSPARENT=true&QUERY_LAYERS=c5_camaras_videovigilancia&TILED=true&TILESORIGIN=-180%2C-90&LAYERS=c5_camaras_videovigilancia&INFO_FORMAT=application%2Fjson&feature_count=100&I=24&J=122&WIDTH=256&HEIGHT=256&CRS=EPSG%3A3857&BBOX=-11036283.891926888%2C2211170.354233578%2C-11026499.952306386%2C2220954.2938540806",
    "https://geoportal.mapoteca.com.mx/proxy/wms/1?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&FORMAT=image%2Fpng&TRANSPARENT=true&QUERY_LAYERS=c5_camaras_videovigilancia&TILED=true&TILESORIGIN=-180%2C-90&LAYERS=c5_camaras_videovigilancia&INFO_FORMAT=application%2Fjson&feature_count=100&I=185&J=237&WIDTH=256&HEIGHT=256&CRS=EPSG%3A3857&BBOX=-11036283.891926888%2C2211170.354233578%2C-11026499.952306386%2C2220954.2938540806",
    "https://geoportal.mapoteca.com.mx/proxy/wms/1?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&FORMAT=image%2Fpng&TRANSPARENT=true&QUERY_LAYERS=c5_camaras_videovigilancia&TILED=true&TILESORIGIN=-180%2C-90&LAYERS=c5_camaras_videovigilancia&INFO_FORMAT=application%2Fjson&feature_count=100&I=166&J=186&WIDTH=256&HEIGHT=256&CRS=EPSG%3A3857&BBOX=-11036283.891926888%2C2211170.354233578%2C-11026499.952306386%2C2220954.2938540806",
    "https://geoportal.mapoteca.com.mx/proxy/wms/1?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&FORMAT=image%2Fpng&TRANSPARENT=true&QUERY_LAYERS=c5_camaras_videovigilancia&TILED=true&TILESORIGIN=-180%2C-90&LAYERS=c5_camaras_videovigilancia&INFO_FORMAT=application%2Fjson&feature_count=100&I=234&J=192&WIDTH=256&HEIGHT=256&CRS=EPSG%3A3857&BBOX=-11046067.83154739%2C2211170.354233578%2C-11036283.891926888%2C2220954.2938540806"

]

def extraer_bloques_camaras(urls):
    print(f"Iniciando extracción de {len(urls)} bloques de cámaras...")
    camaras_encontradas = {}
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
        'Accept': 'application/json'
    }

    for i, url in enumerate(urls):
        if "Pega_aqui" in url or not url.strip():
            continue
            
        print(f"Consultando bloque {i+1}/{len(urls)}...", end=" ")
        
        try:
            # Hacemos la petición con la Request URL exacta del navegador
            respuesta = requests.get(url, headers=headers, timeout=10)
            
            if respuesta.status_code == 200:
                try:
                    datos = respuesta.json()
                    features = datos.get('features', [])
                    print(f"¡Atrapadas {len(features)} cámaras!")
                    
                    for feature in features:
                        props = feature.get('properties', {})
                        
                        # Capturamos el ID de la cámara de manera flexible
                        id_camara = props.get('id') or props.get('id unico') or props.get('id_poste')
                        if not id_camara:
                            id_camara = f"C5_GEN_{len(camaras_encontradas)}"
                            
                        # Capturamos latitud y longitud directamente de la respuesta del servidor
                        lat = props.get('latitud') or props.get('coory') or props.get('y')
                        lon = props.get('longitud') or props.get('coorx') or props.get('x')
                        
                        if lat and lon:
                            try:
                                camaras_encontradas[str(id_camara)] = (float(lon), float(lat))
                            except ValueError:
                                pass # Ignorar valores mal formateados
                                
                except json.JSONDecodeError:
                    print("Error: El servidor no devolvió un JSON válido.")
            else:
                print(f"Error HTTP {respuesta.status_code}")
                
        except requests.exceptions.RequestException as e:
            print(f"Error de conexión: {e}")

    print(f"\n✅ Proceso terminado. Total de cámaras únicas extraídas: {len(camaras_encontradas)}")
    return camaras_encontradas

def indexar_en_redis(camaras_dict):
    if not camaras_dict:
        print("No hay cámaras para indexar en Redis.")
        return
        
    print(f"Indexando {len(camaras_dict)} cámaras en Redis...")
    r.delete(REDIS_GEO_KEY)
    pipe = r.pipeline()
    
    for id_camara, (lon, lat) in camaras_dict.items():
        # Formato correcto que exige redis-py: (longitud, latitud, id_camara)
        pipe.geoadd(REDIS_GEO_KEY, (lon, lat, id_camara))
        
    pipe.execute()
    print(f"✅ ¡Base de datos lista! Se han guardado las cámaras correctamente en Redis.")

if __name__ == "__main__":
    if len(URLS_MANUALES) > 0:
        diccionario_camaras = extraer_bloques_camaras(URLS_MANUALES)
        indexar_en_redis(diccionario_camaras)
    else:
        print("⚠️ Advertencia: La lista URLS_MANUALES está vacía. Pega al menos una Request URL para continuar.")
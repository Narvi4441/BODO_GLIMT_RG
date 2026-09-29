import requests

class GoogleMapsIntegration:
    def __init__(self, api_key):
        self.api_key = api_key
        # Usamos Routes API v2, optimizada para telemetría y tráfico en tiempo real
        self.routes_url = "https://routes.googleapis.com/directions/v2:computeRoutes"
        self.matrix_url = "https://maps.googleapis.com/maps/api/distancematrix/json"

    def generar_ruta_teorica(self, lat_origen, lon_origen, lat_destino, lon_destino):
        """
        Obtiene la ruta óptima considerando tráfico actual.
        Devuelve el tiempo, la distancia y la polilínea codificada para guardar en PostgreSQL.
        """
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self.api_key,
            # FieldMask restringe la respuesta solo a los datos que necesitamos, ahorrando latencia y ancho de banda
            "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline"
        }
        
        payload = {
            "origin": {
                "location": {"latLng": {"latitude": lat_origen, "longitude": lon_origen}}
            },
            "destination": {
                "location": {"latLng": {"latitude": lat_destino, "longitude": lon_destino}}
            },
            "travelMode": "DRIVE", # Se puede cambiar a TRANSIT o WALK dependiendo del usuario
            "routingPreference": "TRAFFIC_AWARE"
        }
        
        try:
            respuesta = requests.post(self.routes_url, json=payload, headers=headers)
            
            if respuesta.status_code == 200:
                datos = respuesta.json()
                if "routes" in datos:
                    ruta = datos["routes"][0]
                    return {
                        "exito": True,
                        "distancia_metros": ruta.get("distanceMeters"),
                        "eta_segundos": int(ruta.get("duration", "0s").replace("s", "")),
                        "polilinea": ruta.get("polyline", {}).get("encodedPolyline")
                    }
            return {"exito": False, "error": respuesta.status_code, "detalle": respuesta.text}
            
        except Exception as e:
            return {"exito": False, "error": "Excepcion local", "detalle": str(e)}

    def actualizar_eta_dinamico(self, lat_actual, lon_actual, lat_destino, lon_destino):
        """
        Consulta rápida a Distance Matrix para actualizar el ETA en el panel del Tutor.
        """
        parametros = {
            "origins": f"{lat_actual},{lon_actual}",
            "destinations": f"{lat_destino},{lon_destino}",
            "key": self.api_key,
            "departure_time": "now" # Obliga a considerar el tráfico en el momento exacto
        }
        
        try:
            respuesta = requests.get(self.matrix_url, params=parametros)
            if respuesta.status_code == 200:
                datos = respuesta.json()
                if datos["status"] == "OK":
                    elemento = datos["rows"][0]["elements"][0]
                    # Retorna el tiempo en tráfico si está disponible, si no, el tiempo normal
                    if "duration_in_traffic" in elemento:
                        tiempo_texto = elemento["duration_in_traffic"]["text"]
                    else:
                        tiempo_texto = elemento["duration"]["text"]
                    return {"exito": True, "eta_texto": tiempo_texto}
            return {"exito": False, "error": "Fallo en Distance Matrix"}
        except Exception as e:
            return {"exito": False, "error": str(e)}

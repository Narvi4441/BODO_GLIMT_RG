import requests
import math
import re
import polyline

class GoogleMapsIntegration:
    def __init__(self, api_key):
        self.api_key = api_key
        # Usamos Routes API v2, optimizada para telemetría y tráfico en tiempo real
        self.routes_url = "https://routes.googleapis.com/directions/v2:computeRoutes"
        self.matrix_url = "https://maps.googleapis.com/maps/api/distancematrix/json"

    def plan_route(self, origin, destination, waypoint=None):
        if not self.api_key:
            raise ValueError("Routes unavailable")
        response = requests.post(
            self.routes_url,
            headers={
                "Content-Type": "application/json",
                "X-Goog-Api-Key": self.api_key,
                "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
            },
            json={
                "origin": {"location": {"latLng": {"latitude": origin["lat"], "longitude": origin["lng"]}}},
                "destination": {"location": {"latLng": {"latitude": destination["lat"], "longitude": destination["lng"]}}},
                "travelMode": "WALK",
                **({"intermediates": [{"location": {"latLng": {
                    "latitude": waypoint["lat"], "longitude": waypoint["lng"]}}}]} if waypoint else {}),
            },
            timeout=8,
            allow_redirects=False,
        )
        if response.status_code != 200:
            raise ValueError("Routes unavailable")
        route = response.json()["routes"][0]
        distance = route["distanceMeters"]
        duration = route["duration"]
        encoded = route["polyline"]["encodedPolyline"]
        if type(distance) is not int or distance < 0:
            raise ValueError("Invalid route distance")
        if not isinstance(duration, str) or not re.fullmatch(r"[0-9]+(?:\.[0-9]{1,9})?s", duration):
            raise ValueError("Invalid route duration")
        if not isinstance(encoded, str) or not encoded or any(not 63 <= ord(c) <= 126 for c in encoded):
            raise ValueError("Invalid route polyline")
        points = polyline.decode(encoded)
        if len(points) < 2 or any(not (-90 <= lat <= 90 and -180 <= lng <= 180) for lat, lng in points):
            raise ValueError("Invalid route path")
        return {
            "origin": origin,
            "destination": destination,
            "distance_m": distance,
            "duration_s": math.ceil(float(duration[:-1])),
            "path": [{"lat": lat, "lng": lng} for lat, lng in points],
        }

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

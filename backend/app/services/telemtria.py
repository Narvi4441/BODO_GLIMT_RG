import math
from app.realtime.c5_service import GeoC5Service

class MotorTelemetria:
    def __init__(self):
        self.c5 = GeoC5Service()
        self.TOLERANCIA_DESVIACION = 50.0 

    def haversine(self, lat1, lon1, lat2, lon2):
        R = 6371000 
        phi_1, phi_2 = math.radians(lat1), math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lon2 - lon1)
        a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi_1) * math.cos(phi_2) * math.sin(delta_lambda / 2.0) ** 2
        return R * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))

    def distancia_a_segmento(self, lat_pt, lon_pt, lat_v, lon_v, lat_w, lon_w):
        l2 = self.haversine(lat_v, lon_v, lat_w, lon_w) ** 2
        if l2 == 0: return self.haversine(lat_pt, lon_pt, lat_v, lon_v)
        t = max(0, min(1, ((lon_pt - lon_v) * (lon_w - lon_v) + (lat_pt - lat_v) * (lat_w - lat_v)) / ((lon_w - lon_v)**2 + (lat_w - lat_v)**2)))
        proy_lon = lon_v + t * (lon_w - lon_v)
        proy_lat = lat_v + t * (lat_w - lat_v)
        return self.haversine(lat_pt, lon_pt, proy_lat, proy_lon)

    def evaluar_posicion(self, lat_actual, lon_actual, ruta_teorica):
        distancia_minima = float('inf')
        
        for i in range(len(ruta_teorica) - 1):
            pt_v, pt_w = ruta_teorica[i], ruta_teorica[i+1]
            dist = self.distancia_a_segmento(lat_actual, lon_actual, pt_v['lat'], pt_v['lon'], pt_w['lat'], pt_w['lon'])
            if dist < distancia_minima: distancia_minima = dist
                
        if distancia_minima > self.TOLERANCIA_DESVIACION:
            return self.disparar_alerta(lat_actual, lon_actual, distancia_minima)
            
        return {"estado": "SEGURO", "distancia_desvio_m": round(distancia_minima, 2)}

    def disparar_alerta(self, lat_actual, lon_actual, desviacion):
        infrastructure = self.c5.localizar_infraestructura_cercana(lat_actual, lon_actual)
        if infrastructure["encontrado"]:
            dist = infrastructure["distancia_metros"]
            metadata_poste = infrastructure["metadata"]
            return {
                "estado": "PELIGRO",
                "motivo": f"Desvío de {round(desviacion, 2)}m",
                "distancia_al_poste_m": round(dist, 2),
                "refugio_recomendado": metadata_poste
            }
        return {"estado": "PELIGRO", "motivo": "Sin postes cercanos en 1km."}
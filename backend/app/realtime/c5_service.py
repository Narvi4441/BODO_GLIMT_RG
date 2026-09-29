import redis

class GeoC5Service:
    def __init__(self):
        # Conexión al mismo puerto del contenedor aislado
        self.r = redis.Redis(host='localhost', port=6380, db=0, decode_responses=True)
        self.geo_key = "acompanamiento:cdmx:c5"

    def localizar_infraestructura_cercana(self, lat_usuario, lon_usuario, radio_metros=1000, limite=1):
        """
        Busca el poste C5 más cercano en milisegundos usando Redis.
        """
        resultados = self.r.geosearch(
            name=self.geo_key,
            longitude=lon_usuario,
            latitude=lat_usuario,
            radius=radio_metros,
            unit='m',
            sort='ASC',
            count=limite,
            withdist=True
        )
        
        # Formatear la respuesta para el backend
        if resultados:
            id_cercano, distancia = resultados[0]
            return {
                "encontrado": True,
                "id_poste": id_cercano,
                "distancia_metros": round(distancia, 1)
            }
        return {"encontrado": False, "mensaje": "Sin infraestructura en el radio"}

import polyline
from shapely.geometry import Point, LineString

class TelemetryEvaluator:
    def __init__(self, umbral_desviacion_metros=150):
        # La distancia máxima permitida antes de detonar una alerta
        self.umbral_desviacion = umbral_desviacion_metros

    def evaluar_desviacion(self, lat_actual, lon_actual, polilinea_codificada):
        """
        Decodifica la ruta teórica y calcula a cuántos metros de distancia 
        se encuentra el usuario respecto al trazo original.
        """
        try: 
            # 1. Decodificar la polilínea
            coordenadas_ruta = polyline.decode(polilinea_codificada)
            
            # 2. Convertir a objetos 
            linea_ruta = LineString([(lon, lat) for lat, lon in coordenadas_ruta])
            punto_actual = Point(lon_actual, lat_actual)
            
            # 3. Calcular la distancia mínima (ortogonal) del punto a la línea en grados
            distancia_grados = linea_ruta.distance(punto_actual)
            
            # 4. Convertir grados a metros 
            factor_conversion_cdmx = 111320 * 0.943 
            distancia_metros = distancia_grados * factor_conversion_cdmx
            
            # 5. Regla de negocio
            es_desviacion = distancia_metros > self.umbral_desviacion
            
            return {
                "exito": True,
                "alerta_desviacion": es_desviacion,
                "distancia_a_ruta_metros": round(distancia_metros, 1),
                "estado": "FUERA_DE_RUTA" if es_desviacion else "NORMAL"
            }
            
        except Exception as e:
            return {"exito": False, "error": f"Fallo al evaluar telemetría: {str(e)}"}

    def evaluar_acelerometro(self, vector_x, vector_y, vector_z, umbral_gravedad=2.5):
        """
        Detecta movimientos bruscos (caídas, choques o forcejeos).
        Calcula la magnitud del vector. (1.0 = gravedad normal en reposo).
        """
        magnitud = (vector_x**2 + vector_y**2 + vector_z**2) ** 0.5
        
        es_movimiento_brusco = magnitud > umbral_gravedad
        return {
            "alerta_acelerometro": es_movimiento_brusco,
            "fuerza_g": round(magnitud, 2)
        }

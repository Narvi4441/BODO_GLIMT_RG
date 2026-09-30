"""Preserves the existing caller interface over the persistent C5 service."""
from app.services.c5_repository import nearest


class GeoC5Service:
    def localizar_infraestructura_cercana(self, lat_usuario, lon_usuario, radio_metros=1000, limite=1):
        # Existing method returns one closest infrastructure record.
        return nearest(lat_usuario, lon_usuario, radio_metros)

"""Entrega de enlaces Monitor por Telegram, sin exponer credenciales."""
import os

import requests


class TelegramDeliveryError(RuntimeError):
    pass


def send_monitor_link(monitor_url: str, destination: str | None = None) -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("TELEGRAM_DEFAULT_CHAT_ID", "").strip()
    if not token or not chat_id:
        raise TelegramDeliveryError("No se pudo enviar el enlace por Telegram.")
    message = "🛡️ GUARDIAN Core — seguimiento compartido\n\nSe inició un acompañamiento.\n\n"
    if destination:
        message += f"Destino: {destination}\n\n"
    message += ("Puedes visualizar la ubicación, riesgo y recorrido\n"
                "mientras el trayecto permanezca activo:\n\n" + monitor_url)
    try:
        with requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": message},
            timeout=8,
            allow_redirects=False,
        ) as response:
            if response.status_code != 200 or response.json().get("ok") is not True:
                raise TelegramDeliveryError("No se pudo enviar el enlace por Telegram.")
    except (requests.RequestException, ValueError, AttributeError, TypeError):
        # Las excepciones HTTP pueden contener la URL con el token: no propagarlas.
        raise TelegramDeliveryError("No se pudo enviar el enlace por Telegram.") from None

"""Entrega de enlaces Monitor por Telegram, sin exponer credenciales."""
import os
import logging

import requests


class TelegramDeliveryError(RuntimeError):
    pass


def send_monitor_link(monitor_url: str, destination: str | None = None) -> None:
    message = "🛡️ GUARDIAN Core — seguimiento compartido\n\nSe inició un acompañamiento.\n\n"
    if destination:
        message += f"Destino: {destination}\n\n"
    message += ("Puedes visualizar la ubicación, riesgo y recorrido\n"
                "mientras el trayecto permanezca activo:\n\n" + monitor_url)
    _send_text(message)


def _send_text(message: str) -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("TELEGRAM_DEFAULT_CHAT_ID", "").strip()
    if not token or not chat_id:
        raise TelegramDeliveryError("No se pudo enviar el enlace por Telegram.")
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


def send_alert(monitor_url: str, name: str | None, reason: str, panic: bool = False) -> None:
    person = f'La persona "{name}"' if name else "La persona monitoreada"
    if panic:
        message = f"🚨 GUARDIAN Core — BOTÓN DE PÁNICO\n\n{person} solicitó ayuda durante su recorrido."
    else:
        readable = {
            "SUDDEN_SPEED_INCREASE": "Se detectó un aumento brusco de velocidad durante el recorrido.",
            "USER_REQUESTED_HELP": "La persona solicitó ayuda.",
            "Significant route deviation": "Desviación severa de la ruta planificada.",
            "Route deviation detected": "Desviación de la ruta planificada.",
        }.get(reason, "Se detectaron condiciones de riesgo crítico durante el recorrido.")
        message = f"🚨 GUARDIAN Core — ALERTA CRÍTICA\n\n{person} está en riesgo crítico.\n\nMotivo:\n{readable}"
    _send_text(message + "\n\nSeguimiento en tiempo real:\n" + monitor_url)


def notify_critical(journey_id: str, reason: str) -> None:
    """Best effort en background; solo un acceso del sistema Monitor existente."""
    from app.core.database import get_engine
    from app.services.auth_repository import find_tutors, find_user_by_id
    from app.services.journey_state import get_journey
    from app.services.monitor_state import journey_access, get_or_create_access, get_access, remember_name
    from app.services.risk_state import get_last_risk_status
    from app.services.risk import panic_active

    try:
        journey = get_journey(journey_id)
        if (not journey or journey["status"] != "ACTIVE" or panic_active(journey_id)
                or get_last_risk_status(journey_id) != "CRITICAL"):
            return
        existing = journey_access(journey_id, journey["user_id"])
        if existing:
            token, access = existing
        else:
            with get_engine().connect() as connection:
                tutors = find_tutors(connection, int(journey["user_id"]))
                user = find_user_by_id(connection, int(journey["user_id"]))
            if not tutors:
                return
            token = get_or_create_access(journey_id, journey["user_id"], tutors[0]["id_tutor"])
            if token is None:
                return
            remember_name(token, user["nombre_completo"] if user else None)
            access = get_access(token)
        base = os.getenv("FRONTEND_URL", "").strip().rstrip("/")
        if not base or not access or get_access(token) is None:
            return
        send_alert(base + "/?monitor=" + token, access.get("user_name"), reason)
    except Exception:
        # No URLs, tokens, datos personales ni excepciones HTTP en logs.
        logging.getLogger(__name__).warning("No se pudo enviar la alerta crítica por Telegram.")

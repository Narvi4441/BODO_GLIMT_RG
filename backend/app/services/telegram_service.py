import os
import requests


def send_monitor_link(
    *,
    monitor_url: str,
    destination: str | None = None,
    reason: str = "Recorrido compartido",
) -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("TELEGRAM_DEFAULT_CHAT_ID", "").strip()

    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN no configurado")

    if not chat_id:
        raise RuntimeError("TELEGRAM_DEFAULT_CHAT_ID no configurado")

    text = (
        "🛡️ GUARDIAN Core — seguimiento compartido\n\n"
        f"{reason}\n"
    )

    if destination:
        text += f"\nDestino: {destination}\n"

    text += (
        "\nPuedes visualizar el recorrido mientras permanezca activo:\n"
        f"{monitor_url}"
    )

    response = requests.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": False,
        },
        timeout=8,
    )

    response.raise_for_status()

    data = response.json()

    if not data.get("ok"):
        raise RuntimeError("Telegram rechazó el mensaje")
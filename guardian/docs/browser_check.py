"""Verificación opcional: pip install playwright; requiere Chrome instalado."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect


with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1100})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://localhost:5173")
    expect(page.get_by_text("EN LÍNEA", exact=True)).to_be_visible(timeout=20000)
    page.get_by_label("Intervalo de telemetría").select_option("0.5")
    page.get_by_role("button", name="Aplicar").click()
    expect(page.get_by_text("Intervalo aplicado: 0.5 s", exact=True).first).to_be_visible()
    for name, message in [
        ("Solicitar check-in", "Check-in automático confirmado por NODE-A simulado"),
        ("Activar emergencia", "Modo de emergencia activado"),
        ("Restaurar modo normal", "Modo normal restaurado; continúa evaluación de sensores"),
    ]:
        page.get_by_role("button", name=name).click()
        expect(page.locator(".ack-row").first).to_contain_text(message)
        expect(page.locator(".ack-row").first).to_contain_text("ACK")
        if name == "Activar emergencia":
            expect(page.locator(".risk-state")).to_have_text("CRITICAL")
    page.get_by_label("Intervalo de telemetría").select_option("1")
    page.get_by_role("button", name="Aplicar").click()
    expect(page.locator(".ack-row").first).to_contain_text("Intervalo aplicado: 1 s")
    output = Path(".tools")
    page.screenshot(path=str(output / "desktop.png"), full_page=True)
    for width in (390, 320):
        page.set_viewport_size({"width": width, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Overflow at {width}px"
    page.screenshot(path=str(output / "mobile.png"), full_page=True)
    assert page.evaluate("'serviceWorker' in navigator")
    page.evaluate("navigator.serviceWorker.ready")
    assert not errors, errors
    browser.close()
    print("OK React en vivo, 4 comandos con ACK, emergencia CRITICAL, móvil 390/320 px y service worker")

"""Opt-in: RUN_BROWSER_TESTS=1; requiere Google Chrome instalado."""
import os
from pathlib import Path
import subprocess
import sys
import time
import httpx
import pytest
from sqlalchemy import text

pytestmark = pytest.mark.skipif(os.getenv("RUN_BROWSER_TESTS") != "1", reason="Prueba de navegador opt-in")


def test_mobile_registration_real_database(database, payload):
    from playwright.sync_api import sync_playwright, expect
    with database.connect() as connection:
        schema = connection.execute(text("SELECT current_schema()")).scalar_one()
    env = dict(os.environ, DATABASE_URL=database.url.update_query_dict(
        {"options": f"-csearch_path={schema}"}
    ).render_as_string(hide_password=False))
    # Instancia de API exclusiva de esta prueba; no altera el backend en ejecución.
    process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "18080", "--no-access-log"],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    try:
        for _ in range(100):
            try:
                if httpx.get("http://127.0.0.1:18080/", timeout=1).status_code == 200:
                    break
            except httpx.TransportError:
                pass
            time.sleep(.1)
        else:
            pytest.fail("La API de prueba no inició")
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", headless=True)
            page = browser.new_page(viewport={"width": 390, "height": 844})
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto("http://127.0.0.1:18080/ui/", wait_until="domcontentloaded")
            assert not errors, errors
            page.locator('#accessBtn').click()
            page.locator('#createAccount').click()
            page.locator('#registerBtn').click()
            expect(page.locator('#regNameErr')).to_have_text('El nombre es obligatorio.')
            fields = {'regName': payload['nombre_completo'], 'regPhone': payload['telefono'],
                      'regEmail': payload['email'], 'regPassword': payload['password'],
                      'regConfirm': 'no coincide', 'regTutorName': payload['tutor']['nombre_completo'],
                      'regTutorPhone': payload['tutor']['telefono'], 'regTutorEmail': payload['tutor']['email'],
                      'regRelation': payload['tutor']['relacion']}
            for field, value in fields.items():
                page.locator('#' + field).fill(value)
            page.locator('#registerBtn').click()
            expect(page.locator('#regConfirmErr')).to_have_text('Las contraseñas no coinciden.')
            page.locator('#regConfirm').fill(payload['password'])
            for width in (320, 390):
                page.set_viewport_size({'width': width, 'height': 844})
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                assert page.locator('#registerForm').evaluate('el => el.scrollWidth <= el.clientWidth')
            expect(page.locator('#themeBtn')).not_to_be_visible()
            artifacts = Path(__file__).resolve().parents[2] / '.tools'
            artifacts.mkdir(exist_ok=True)
            page.locator('#registerForm').evaluate('el => el.scrollTop = 0')
            page.screenshot(path=str(artifacts / 'registration-mobile.png'))
            page.locator('#registerBtn').click()
            expect(page.locator('#loginMessage')).to_contain_text('Usuario registrado correctamente', timeout=10000)
            expect(page.locator('#em')).to_have_value(payload['email'])
            expect(page.locator('#registerForm')).not_to_be_visible()
            # El duplicado se comprueba en PostgreSQL y se muestra junto al campo.
            page.locator('#createAccount').click()
            for field, value in fields.items():
                page.locator('#' + field).fill(payload['password'] if field == 'regConfirm' else value)
            page.locator('#registerBtn').click()
            expect(page.locator('#regEmailErr')).to_have_text('Este correo ya está registrado.')
            page.locator('#registerBack').click()
            page.locator('#em').fill(payload['email'])
            page.locator('#pw').fill('contraseña incorrecta')
            page.locator('#loginBtn').click()
            expect(page.locator('#loginMessage')).to_contain_text('Correo o contraseña incorrectos.')
            page.locator('#pw').fill(payload['password'])
            page.locator('#loginBtn').click()
            expect(page.locator('#app')).to_be_visible()
            page.locator('#avatarBtn').click()
            expect(page.locator('#pName')).to_have_text(payload['nombre_completo'])
            expect(page.locator('#tName')).to_have_value(payload['tutor']['nombre_completo'])
            page.locator('#viewUser [data-logout]').click()
            page.locator('#accessBtn').click()
            page.locator('[data-role=admin]').click()
            expect(page.locator('#loginBtn')).to_have_text('Abrir demo de administrador')
            page.locator('#loginBtn').click()
            expect(page.locator('#viewAdmin')).to_be_visible()
            assert not errors, errors
            browser.close()
    finally:
        process.terminate()
        process.wait(timeout=10)

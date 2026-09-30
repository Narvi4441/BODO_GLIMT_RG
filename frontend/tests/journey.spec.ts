import { expect, test } from '@playwright/test'

test('PWA: journey real, teleprocesos/ACK, offline en orden, cierre y shell offline', async ({ page, context, request }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const sent: { timestamp: string; network_status: string }[] = []
  page.on('request', req => { if (req.url().endsWith('/api/telemetry')) sent.push(req.postDataJSON()) })
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await page.reload()
  await expect(page.getByRole('heading', { name: /Tu camino/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/home-mobile.png', fullPage: true })
  const started = page.waitForResponse(response => response.url().endsWith('/api/journeys/start') && response.status() === 200)
  await page.getByRole('button', { name: 'Iniciar trayecto protegido' }).click()
  const journey = await (await started).json()
  await expect(page.getByText('Conectado', { exact: true })).toBeVisible()
  await expect(page.getByText('19.432600', { exact: true })).toBeVisible()
  await expect.poll(() => sent.length).toBeGreaterThan(0)
  expect(await page.getByTestId('interval').textContent()).toBe('5 s')
  const command = async (action: string, value: number | null = null) => {
    const response = await request.post('http://127.0.0.1:18081/api/commands', { data: { journey_id: journey.journey_id, user_id: journey.user_id, action, value } })
    expect(response.ok()).toBe(true)
    return response.json()
  }
  const ackResponses: {status: string; message: string}[] = []
  page.on('request', req => { if (req.url().endsWith('/ack')) ackResponses.push(req.postDataJSON()) })
  await command('SET_TELEMETRY_RATE', 1)
  await expect(page.getByTestId('interval')).toHaveText('1 s')
  await expect(page.locator('.ack')).toContainText('EXECUTED')
  const samples = sent.length
  await expect.poll(() => sent.length, { timeout: 10000 }).toBeGreaterThan(samples + 1)
  await command('REQUEST_CHECK_IN')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Estoy bien', exact: true }).click()
  await expect(page.locator('.ack')).toContainText('Estoy bien')
  await command('EMERGENCY_MODE')
  await expect(page.getByRole('heading', { name: 'CRITICAL', exact: true })).toBeVisible()
  await command('UNKNOWN_ACTION')
  await expect(page.locator('.ack')).toContainText('FAILED')
  expect(ackResponses.map(ack => ack.status)).toEqual(expect.arrayContaining(['RECEIVED', 'EXECUTING', 'EXECUTED', 'FAILED']))
  await page.screenshot({ path: 'test-results/active-mobile.png', fullPage: true })
  await context.setOffline(true)
  await expect(page.getByText('Sin conexión · OFFLINE', { exact: true })).toBeVisible()
  await expect.poll(() => page.locator('.buffer strong').textContent(), { timeout: 10000 }).toMatch(/[2-9]\d* pendientes/)
  const offlinePoints = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('guardian-core'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
    const values = await new Promise<any[]>(resolve => { const req = db.transaction('pending').objectStore('pending').getAll(); req.onsuccess = () => resolve(req.result) })
    db.close()
    return values.filter(item => item.kind === 'telemetry').map(item => item.payload.timestamp)
  })
  const beforeReconnect = sent.length
  await context.setOffline(false)
  await expect(page.getByText(/puntos recuperados y confirmados/)).toBeVisible({ timeout: 20000 })
  await expect(page.locator('.buffer')).not.toBeVisible({ timeout: 20000 })
  expect(sent.slice(beforeReconnect).map(point => point.timestamp).slice(0, offlinePoints.length)).toEqual(offlinePoints)
  // Finalizar sin conexión detiene GPS, conserva puntos y difiere cierre remoto.
  await context.setOffline(true)
  await expect(page.locator('.buffer')).toBeVisible({ timeout: 10000 })
  await page.getByRole('button', { name: 'Finalizar trayecto' }).click()
  await expect(page.getByRole('heading', { name: 'GPS detenido' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'GPS detenido' })).toBeVisible()
  const pending = await page.locator('.buffer strong').textContent()
  await page.waitForTimeout(2000)
  expect(await page.locator('.buffer strong').textContent()).toBe(pending)
  await context.setOffline(false)
  await expect(page.getByRole('button', { name: 'Iniciar trayecto protegido' })).toBeVisible({ timeout: 20000 })
  const remote = await request.get(`http://127.0.0.1:18081/api/journeys/${journey.journey_id}`)
  expect((await remote.json()).status).toBe('COMPLETED')
  const finalSamples = sent.length
  await page.waitForTimeout(2500)
  expect(sent.length).toBe(finalSamples)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: /Tu camino/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Iniciar trayecto protegido' })).toBeDisabled()
  expect(errors).toEqual([])
})

test('Risk Engine del backend genera el teleproceso y la PWA lo confirma', async ({ page, request }) => {
  await page.goto('/')
  const response = page.waitForResponse(response => response.url().endsWith('/api/journeys/start'))
  const initialTelemetry = page.waitForResponse(response => response.url().endsWith('/api/telemetry') && response.status() === 200)
  await page.getByRole('button', { name: 'Iniciar trayecto protegido' }).click()
  const journey = await (await response).json()
  await initialTelemetry
  await expect(page.getByText('Conectado', { exact: true })).toBeVisible()
  const executed = page.waitForRequest(req => req.url().endsWith('/ack') && req.postDataJSON()?.status === 'EXECUTED' && req.postDataJSON()?.message === 'Intervalo aplicado: 1 s.')
  // Estímulo sintético SOLO en la prueba; la PWA no inventa estos sensores.
  const stimulus = await request.post('http://127.0.0.1:18081/api/telemetry', { data: {
    journey_id: journey.journey_id, user_id: journey.user_id,
    latitude: 19.4326, longitude: -99.1332,
    accuracy: 150, latency_ms: 600, network_status: 'DEGRADED',
  } })
  const result = await stimulus.json()
  expect(result.risk.status).toBe('PRECAUTION')
  expect(result.automatic_command.action).toBe('SET_TELEMETRY_RATE')
  const ack = await executed
  expect(ack.url()).toContain(result.automatic_command.command_id)
  await expect(page.getByTestId('interval')).toHaveText('1 s')
  const requestCheck = await request.post('http://127.0.0.1:18081/api/commands', { data: {
    journey_id: journey.journey_id, user_id: journey.user_id, action: 'REQUEST_CHECK_IN', value: null,
  } })
  expect(requestCheck.ok()).toBe(true)
  await page.getByRole('button', { name: 'Necesito ayuda', exact: true }).click()
  await expect(page.locator('.ack')).toContainText('Necesito ayuda')
  await expect(page.getByRole('heading', { name: 'CRITICAL', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Finalizar trayecto' }).click()
  await expect(page.getByRole('button', { name: 'Iniciar trayecto protegido' })).toBeVisible({ timeout: 15000 })
})

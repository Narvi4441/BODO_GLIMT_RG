import { api, ApiError } from './api'
import { offline } from './offline'
import { JourneySocket } from './websocket'
import type { AckStatus, Command, Journey, NetworkStatus, PendingItem, RealtimeEvent, Risk, Telemetry } from '../types'

export interface JourneyState {
  ready: boolean; journey: Journey | null; acquiring: boolean; stopPending: boolean;
  busy: boolean; interval: number; network: NetworkStatus; wsConnected: boolean;
  point: Telemetry | null; risk: Risk | null; emergency: boolean;
  latency: number | null; lastSent: string | null; pending: number; recovered: number;
  checkIn: Command | null; lastAck: string; error: string; gpsError: string; storageError: string;
}

function gpsPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) return reject(new Error('El GPS requiere HTTPS confiable o localhost.'))
    if (!navigator.geolocation) return reject(new Error('Este navegador no dispone de geolocalización.'))
    navigator.geolocation.getCurrentPosition(resolve, error => reject(new Error(
      error.code === 1 ? 'Permiso GPS denegado. Habilita la ubicación en los ajustes del navegador.' :
      error.code === 2 ? 'No se pudo obtener ubicación. Comprueba el GPS del dispositivo.' : 'El GPS tardó demasiado. Intenta en un lugar con mejor señal.'
    )), { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 })
  })
}

export class TelemetryController {
  private state: JourneyState = {
    ready: false, journey: null, acquiring: false, stopPending: false, busy: false, interval: 5,
    network: navigator.onLine ? 'ONLINE' : 'OFFLINE', wsConnected: false,
    point: null, risk: null, emergency: false, latency: null, lastSent: null,
    pending: 0, recovered: 0, checkIn: null, lastAck: '', error: '', gpsError: '', storageError: '',
  }
  private listeners = new Set<() => void>()
  private socket?: JourneySocket
  private timer?: ReturnType<typeof setInterval>
  private retry?: ReturnType<typeof setInterval>
  private sampling?: Promise<void>
  private flushing?: Promise<void>
  private handling = new Map<string, AckStatus>()
  private battery: { level: number } | null = null
  private httpHealthy = true
  private initialized = false
  private stopped = false
  // Mantiene los puntos en memoria si IndexedDB falla; se muestra el fallo, nunca éxito falso.
  private unsaved: PendingItem[] = []
  private capturesStopped = false

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.state
  private update(patch: Partial<JourneyState>) {
    this.state = { ...this.state, ...patch }
    this.state.network = !navigator.onLine ? 'OFFLINE' : !this.httpHealthy || (this.state.acquiring && !this.state.wsConnected) ? 'DEGRADED' : 'ONLINE'
    this.listeners.forEach(listener => listener())
  }
  private networkChanged = () => { this.update({}); if (navigator.onLine) void this.sync() }
  private leave = () => { this.pauseAcquisition(); this.socket?.close() }

  async initialize() {
    if (this.initialized) return
    this.initialized = true
    window.addEventListener('online', this.networkChanged)
    window.addEventListener('offline', this.networkChanged)
    window.addEventListener('pagehide', this.leave)
    try {
      const [saved, pending] = await Promise.all([offline.session(), offline.count()])
      this.update({ journey: saved?.journey || null, stopPending: saved?.stopPending || false, pending })
    } catch { this.update({ storageError: 'IndexedDB no está disponible. No inicies un trayecto hasta habilitar el almacenamiento.' }) }
    this.update({ ready: true })
    // Battery Status no existe en Safari; null significa no disponible.
    const nav = navigator as Navigator & { getBattery?: () => Promise<{level: number}> }
    if (nav.getBattery) void nav.getBattery().then(battery => { this.battery = battery }).catch(() => {})
    this.retry = setInterval(() => void this.sync(), 5000)
    void this.sync()
  }

  async start(userId: string) {
    if (this.state.busy || this.state.journey || !this.state.ready) return
    if (!navigator.onLine) { this.update({ error: 'Conéctate para crear un trayecto nuevo.' }); return }
    this.update({ busy: true, error: '', gpsError: '' })
    try {
      await offline.count() // Comprobar almacenamiento antes de crear un viaje remoto.
      const position = await gpsPosition()
      const journey = await api.start(userId)
      this.httpHealthy = true
      this.update({ journey, stopPending: false, risk: null, point: null, emergency: false, lastAck: '', interval: 5, recovered: 0 })
      await offline.saveSession({ journey, stopPending: false })
      this.capturesStopped = false
      this.activate()
      await this.storePosition(position)
    } catch (error) { if (error instanceof ApiError) this.httpHealthy = false; this.update({ error: this.message(error) }) }
    finally { this.update({ busy: false }) }
  }

  async resume() {
    const saved = this.state.journey
    if (!saved || this.state.stopPending || this.state.busy) return
    this.update({ busy: true, error: '' })
    try {
      if (navigator.onLine) {
        const remote = await api.journey(saved.journey_id)
        if (remote.status !== 'ACTIVE') throw new Error('El backend ya cerró este trayecto. Los datos pendientes se conservan.')
      }
      const position = await gpsPosition()
      this.capturesStopped = false
      this.activate()
      await this.storePosition(position)
    } catch (error) { this.update({ error: this.message(error) }) }
    finally { this.update({ busy: false }) }
  }

  private activate() {
    this.stopped = false
    this.update({ acquiring: true, gpsError: '' })
    this.socket?.close()
    this.socket = new JourneySocket(this.state.journey!.journey_id, this.realtime, connected => this.update({ wsConnected: connected }))
    this.setIntervalSeconds(this.state.interval)
  }
  private setIntervalSeconds(seconds: number) {
    clearInterval(this.timer)
    this.update({ interval: seconds })
    if (this.state.acquiring) this.timer = setInterval(() => void this.sample(), seconds * 1000)
  }
  private sample() {
    if (this.sampling || !this.state.acquiring) return this.sampling
    this.sampling = (async () => {
      try {
        const position = await gpsPosition()
        // getCurrentPosition no tiene cancelación nativa: ignorar callbacks tras detener.
        if (!this.capturesStopped && this.state.acquiring) await this.storePosition(position)
      } catch (error) { if (this.state.acquiring) this.update({ gpsError: this.message(error) }) }
    })().finally(() => { this.sampling = undefined })
    return this.sampling
  }
  private async storePosition(position: GeolocationPosition) {
    if (!this.state.journey) return
    const { coords, timestamp } = position
    const nonNegative = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0 ? value : null
    const point: Telemetry = {
      journey_id: this.state.journey.journey_id, user_id: this.state.journey.user_id,
      latitude: coords.latitude, longitude: coords.longitude, accuracy: nonNegative(coords.accuracy),
      speed: nonNegative(coords.speed), heading: nonNegative(coords.heading),
      battery: this.battery ? Math.round(this.battery.level * 100) : null,
      latency_ms: this.state.latency, packet_loss: null, network_status: this.state.network,
      route_deviation_m: null, timestamp: new Date(timestamp).toISOString(),
    }
    this.update({ point, gpsError: '' })
    await this.enqueue({ kind: 'telemetry', payload: point })
    void this.sync()
  }
  private async enqueue(item: PendingItem) {
    // Orden de asignación de claves IDB = orden de adquisición/ACK.
    try {
      if (this.unsaved.length) throw new Error('Hay datos pendientes de persistir.')
      await offline.enqueue(item)
    } catch {
      this.unsaved.push(item)
      this.pauseAcquisition()
      this.update({ storageError: 'No se pudo guardar en IndexedDB. GPS pausado; conserva abierta esta pantalla para recuperar los puntos en memoria.' })
    }
    await this.count()
  }
  private async count() {
    try { this.update({ pending: await offline.count() + this.unsaved.length }) }
    catch { this.update({ storageError: 'No se puede leer el almacenamiento local.' }) }
  }
  private pauseAcquisition() {
    this.capturesStopped = true
    clearInterval(this.timer)
    this.update({ acquiring: false })
  }

  async stop() {
    if (!this.state.journey || this.state.busy) return
    this.pauseAcquisition()
    this.socket?.close()
    this.stopped = true
    this.update({ busy: true, stopPending: true, wsConnected: false, point: null, risk: null, emergency: false, checkIn: null, latency: null, lastSent: null })
    try {
      await offline.saveSession({ journey: this.state.journey, stopPending: true })
      // Si un punto ya estaba entrando a IndexedDB, esperar su escritura antes del cierre.
      await this.sampling
      for (const [id, status] of this.handling) {
        if (status === 'EXECUTING' || status === 'RECEIVED') await this.ack(id, 'FAILED', 'Trayecto finalizado antes de completar la acción.')
      }
      await this.sync()
    } catch (error) { this.update({ error: this.message(error) }) }
    finally { this.update({ busy: false }) }
  }

  sync = (): Promise<void> => {
    if (this.flushing) return this.flushing
    this.flushing = this.flush().finally(() => { this.flushing = undefined })
    return this.flushing
  }
  private async flush() {
    if (!this.state.ready) return
    let sent = 0
    let exchanged = false
    try {
      while (this.unsaved.length) {
        await offline.enqueue(this.unsaved[0])
        this.unsaved.shift()
      }
      await offline.count()
      if (this.state.storageError) this.update({ storageError: '' })
      if (!navigator.onLine) return
      let item = await offline.first()
      // El número previo permite distinguir sincronización de un único envío en vivo.
      const recovering = this.state.pending > 1 || this.state.network !== 'ONLINE' || this.state.stopPending
      while (item && navigator.onLine) {
        const began = performance.now()
        if (item.kind === 'telemetry') {
          const result = await api.telemetry(item.payload)
          if (result.status !== 'accepted') throw new Error('El backend no confirmó la telemetría.')
          if (!this.stopped && !this.state.stopPending && item.payload.journey_id === this.state.journey?.journey_id) {
            this.update({ risk: result.risk, latency: Math.round(performance.now() - began), lastSent: new Date().toISOString() })
            if (result.automatic_command) void this.command(result.automatic_command)
          }
          if (recovering) sent++
        } else {
          await api.ack(item.command_id, item.payload.status, item.payload.message)
          this.update({ lastAck: `${item.payload.status} · ${item.payload.message}` })
        }
        await offline.remove(item.id!) // Nunca borrar antes de una respuesta exitosa.
        exchanged = true
        this.httpHealthy = true
        await this.count()
        item = await offline.first()
      }
      if (this.state.stopPending && !item && navigator.onLine && this.state.journey) {
        await api.stop(this.state.journey.journey_id)
        this.httpHealthy = true
        exchanged = true
        await offline.clearSession()
        this.handling.clear()
        this.update({ journey: null, stopPending: false, lastAck: '', interval: 5 })
      }
      if (exchanged) this.update({ error: '' })
    } catch (error) {
      this.httpHealthy = false
      const unavailable = error instanceof ApiError && [404, 409].includes(error.status)
      this.update({ error: unavailable ? 'El backend ya no acepta este viaje/comando. Los datos se conservan; puedes descargarlos. No se borraron puntos.' : this.message(error) })
    } finally {
      if (sent) this.update({ recovered: this.state.recovered + sent })
      await this.count()
    }
  }

  private realtime = (event: RealtimeEvent) => {
    if (this.stopped || event.data.journey_id !== this.state.journey?.journey_id) return
    if (event.type === 'command') void this.command(event.data)
    if (event.type === 'command_ack') this.update({ lastAck: `${event.data.status} · ${event.data.message || event.data.action}` })
    if (event.type === 'telemetry') this.update({ risk: { score: event.data.risk_score, status: event.data.risk_status, reasons: event.data.risk_reasons } })
  }
  private async ack(id: string, status: AckStatus, message: string) {
    this.handling.set(id, status)
    await this.enqueue({ kind: 'ack', command_id: id, payload: { status, message } })
    void this.sync()
  }
  private async command(command: Command) {
    if (!this.state.acquiring || this.stopped || command.journey_id !== this.state.journey?.journey_id || command.user_id !== this.state.journey.user_id || this.handling.has(command.command_id)) return
    this.handling.set(command.command_id, 'RECEIVED')
    await this.ack(command.command_id, 'RECEIVED', `${command.action} recibido por la PWA.`)
    if (this.stopped) return
    await this.ack(command.command_id, 'EXECUTING', `${command.action} en ejecución.`)
    if (this.stopped) return
    if (command.action === 'SET_TELEMETRY_RATE') {
      const interval = Number(command.value)
      if (!Number.isFinite(interval) || interval < 1 || interval > 60) { await this.ack(command.command_id, 'FAILED', 'Intervalo admitido: 1 a 60 segundos.'); return }
      this.setIntervalSeconds(interval)
      await this.ack(command.command_id, 'EXECUTED', `Intervalo aplicado: ${interval} s.`)
    } else if (command.action === 'EMERGENCY_MODE') {
      this.update({ emergency: true })
      this.setIntervalSeconds(1)
      await this.ack(command.command_id, 'EXECUTED', 'Modo de emergencia activo; intervalo de 1 s.')
    } else if (command.action === 'REQUEST_CHECK_IN') {
      if (this.state.checkIn) { await this.ack(command.command_id, 'FAILED', 'Ya hay un check-in esperando respuesta.'); return }
      this.update({ checkIn: command })
    } else await this.ack(command.command_id, 'FAILED', 'Acción no soportada por la PWA.')
  }

  async answerCheckIn(ok: boolean) {
    const command = this.state.checkIn
    if (!command) return
    this.update({ checkIn: null })
    if (!ok) { this.update({ emergency: true }); this.setIntervalSeconds(1) }
    await this.ack(command.command_id, 'EXECUTED', ok ? 'El usuario respondió: Estoy bien.' : 'El usuario respondió: Necesito ayuda. Modo local de emergencia activado.')
  }
  async downloadPending() {
    const data = [...await offline.all(), ...this.unsaved]
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'guardian-pendientes.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  private message(error: unknown) { return error instanceof Error ? error.message : 'No se pudo completar la operación.' }
  dispose() {
    this.pauseAcquisition(); this.socket?.close(); clearInterval(this.retry)
    window.removeEventListener('online', this.networkChanged); window.removeEventListener('offline', this.networkChanged); window.removeEventListener('pagehide', this.leave)
  }
}

export const guardian = new TelemetryController()

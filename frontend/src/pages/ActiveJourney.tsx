import { useEffect, useRef, useState } from 'react'
import { JourneyMap } from '../components/JourneyMap'
import { DemoControls } from '../components/DemoControls'
import { deviationLabel } from '../services/demoScenario'
import { api } from '../services/api'
import type { JourneyState } from '../services/telemetry'
import type { Coordinate, DemoState, MonitorContact, RiskZone, RoutePlan, SafetyCamera, TracePoint } from '../types'

const number = (value: number | null | undefined, digits = 0) => value == null ? 'No disponible' : value.toFixed(digits)
const distance = (meters: number) => meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toLocaleString('es-MX', { maximumFractionDigits: 1 })} km`
const duration = (seconds: number) => `${Math.max(1, Math.ceil(seconds / 60))} min aprox.`

function MonitorSharing({ journeyId, routePlan }: { journeyId: string; routePlan: RoutePlan | null }) {
  const [contacts, setContacts] = useState<MonitorContact[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [sharing, setSharing] = useState(false)
  const [sending, setSending] = useState(false)
  const [telegramMessage, setTelegramMessage] = useState('')
  const telegramBusy = useRef(false)
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const version = useRef(0)
  useEffect(() => {
    const abort = new AbortController()
    setLoading(true)
    setError('')
    void api.monitorContacts(abort.signal).then(value => {
      if (!abort.signal.aborted) setContacts(value)
    }).catch(() => {
      if (!abort.signal.aborted) setError('No se pudieron consultar tus personas de confianza. Comprueba tu sesión y conexión.')
    }).finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [attempt])
  useEffect(() => {
    version.current++
    setLink('')
    setCopied(false)
    setSharing(false)
    setSending(false)
    setTelegramMessage('')
    return () => { version.current++ }
  }, [journeyId, selected, routePlan])
  async function share() {
    if (!selected || sharing || telegramBusy.current) return
    const request = ++version.current
    setSharing(true)
    setLink('')
    setError('')
    setCopied(false)
    try {
      const result = await api.createMonitorAccess({
        journey_id: journeyId, tutor_id: Number(selected),
        destination: routePlan ? { ...routePlan.destination, name: routePlan.destinationName, address: routePlan.destinationAddress } : null,
        planned_path: routePlan?.path ?? [],
      })
      if (version.current !== request) return
      const url = new URL('/', window.location.origin)
      url.searchParams.set('monitor', result.token)
      setLink(url.toString())
    } catch {
      if (version.current === request) setError('No se pudo compartir el seguimiento. Revisa tu sesión, conexión y que el recorrido siga activo.')
    } finally { if (version.current === request) setSharing(false) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true) }
    catch { setError('No se pudo copiar. Selecciona el enlace para copiarlo manualmente.') }
  }
  async function sendTelegram() {
    const selectedTutor = contacts.find(contact => contact.id_tutor === Number(selected))
    if (!selectedTutor || sharing || telegramBusy.current) return
    telegramBusy.current = true
    const request = ++version.current
    setSending(true)
    setTelegramMessage('')
    setError('')
    setCopied(false)
    try {
      // Registrar el plan actual usando el acceso existente; Telegram reutiliza ese token.
      await api.createMonitorAccess({
        journey_id: journeyId, tutor_id: selectedTutor.id_tutor,
        destination: routePlan ? { ...routePlan.destination, name: routePlan.destinationName, address: routePlan.destinationAddress } : null,
        planned_path: routePlan?.path ?? [],
      })
      if (version.current !== request) return
      const result = await api.sendMonitorTelegram(journeyId, selectedTutor.id_tutor)
      if (version.current !== request) return
      if (!result.ok || !result.sent) throw new Error('Telegram no confirmó el envío.')
      setLink(result.monitor_url)
      setTelegramMessage('Enlace enviado por Telegram.')
    } catch {
      if (version.current === request) setError('No se pudo enviar el enlace por Telegram.')
    } finally {
      telegramBusy.current = false
      if (version.current === request) setSending(false)
    }
  }
  return <details className="disclosure monitor-sharing">
    <summary>Persona de confianza <span className="summary-hint">Compartir recorrido activo</span></summary>
    <div className="disclosure-body">
      <p className="muted">El enlace permite ver este recorrido mientras siga activo, durante un máximo de 24 horas. Compártelo solo con la persona seleccionada: quien tenga el enlace podrá abrirlo.</p>
      {loading ? <p role="status">Consultando personas vinculadas…</p> : <>
        {contacts.length ? <><label htmlFor="monitor-contact">Persona vinculada</label><select id="monitor-contact" value={selected} disabled={sending} onChange={event => setSelected(event.target.value)}><option value="">Selecciona una persona</option>{contacts.map(contact => <option key={contact.id_tutor} value={contact.id_tutor}>{contact.nombre_completo} · {contact.relacion}</option>)}</select>
          <button className="secondary full" disabled={!selected || sharing || sending} onClick={() => void share()}>{sharing ? 'Preparando enlace…' : 'Compartir seguimiento'}</button>
          <button className="secondary full" disabled={!selected || sharing || sending} onClick={() => void sendTelegram()}>{sending ? 'Enviando...' : 'Enviar por Telegram'}</button>
        </> : <p>No hay personas de confianza vinculadas disponibles.</p>}
      </>}
      {error && <p className="notice" role="alert">{error} <button className="text-button" disabled={loading} onClick={() => setAttempt(value => value + 1)}>Volver a consultar personas</button></p>}
      {telegramMessage && <p className="success" role="status">{telegramMessage}</p>}
      {link && <div className="monitor-link"><label htmlFor="monitor-link">Enlace temporal</label><input id="monitor-link" value={link} readOnly onFocus={event => event.target.select()}/><button className="secondary full" onClick={() => void copy()}>Copiar enlace</button>{copied && <p className="success" role="status">Enlace copiado.</p>}</div>}
    </div>
  </details>
}

export function ActiveJourney({ state: s, routePlan, stop, resume, currentPosition, actualTrace, deviation, demo, activateDemo, changeDemo, exitDemo, safetyCameras, riskZones, panic, emergencyMessage, emergencyRequested }: {
  state: JourneyState
  routePlan: RoutePlan | null
  stop: () => void
  resume: () => void
  currentPosition: Coordinate | null; actualTrace: TracePoint[]; deviation: number | null;
  demo: DemoState | null; activateDemo: () => void; changeDemo: (patch: Partial<DemoState>) => void; exitDemo: () => void;
  safetyCameras: SafetyCamera[]; riskZones: RiskZone[]; panic: () => void; emergencyMessage: string; emergencyRequested: boolean;
}) {
  const [layers, setLayers] = useState({ route: true, trace: true, cameras: false, zones: false })
  const point = s.point
  const riskStatus = s.risk?.status || 'UNKNOWN'
  return <div className="active-page">
    <div className="page-intro active-heading">
      <div><span className="eyebrow">GUARDIAN</span><h1>{s.stopPending ? 'Finalizando recorrido' : 'Recorrido activo'}</h1></div>
      <span className={'network ' + s.network}><i/>{s.network}</span>
    </div>

    <section className="map-section" aria-label="Mapa del recorrido">
      <JourneyMap
        currentPosition={currentPosition}
        origin={routePlan?.origin}
        destination={routePlan?.destination}
        plannedPath={layers.route ? routePlan?.path : undefined}
        actualTrace={layers.trace ? actualTrace : undefined}
        safetyCameras={layers.cameras ? safetyCameras : undefined}
        riskZones={demo && layers.zones ? riskZones : undefined}
      />
    </section>

    <section className="active-route-strip" aria-label="Resumen del recorrido">
      {routePlan ? <>
        <span className="eyebrow">DESTINO</span><h2>{routePlan.destinationName}</h2>
        <p className="route-strip-metrics"><strong>{duration(routePlan.duration_s)}</strong><span aria-hidden="true">·</span><span>{distance(routePlan.distance_m)}</span></p>
        <small className="muted">ETA y distancia iniciales, no restantes.</small>
      </> : <p className="notice route-unavailable" role="status">Ruta planificada no disponible después de esta recarga.</p>}
      <p className="route-strip-deviation">{deviation === null ? 'Desviación no disponible' : <><strong>{deviationLabel(deviation)}</strong> · {Math.round(deviation)} m de desviación</>}{demo && <small> · SIMULACIÓN</small>}</p>
    </section>

    {s.stopPending && <section className="notice closing-notice" role="status">
      <h2>GPS detenido · cierre pendiente</h2>
      <p>Se enviarán primero los datos pendientes y después el cierre al backend. Puedes dejar esta pantalla abierta para sincronizar.</p>
    </section>}

    <section className={'panel risk ' + riskStatus} aria-label="Estado de riesgo">
      <div><span className="eyebrow">ESTADO DE RIESGO</span><h2>{s.risk?.status || 'ESPERANDO DATOS'}</h2></div>
      <div className="risk-score"><strong>{s.risk?.score ?? '—'}</strong><small>SCORE / 100</small></div>
      <p>{s.risk?.reasons[0] || 'El backend evalúa la telemetría recibida.'}</p>
      {!!s.risk && s.risk.reasons.length > 1 && <details className="risk-explainer"><summary>Ver detalles</summary><ul>{s.risk.reasons.slice(1).map((reason, i) => <li key={i}>{reason}</li>)}</ul></details>}
      {s.emergency && <div className="emergency-notice" role="status"><strong>MODO DE EMERGENCIA</strong><p>Frecuencia prioritaria activada. El score y el estado de riesgo mostrados siguen siendo los del backend.</p></div>}
    </section>

    {!s.stopPending && <section className="sos-section" aria-label="Solicitar ayuda">
      <button className={'panic full ' + riskStatus} disabled={emergencyRequested || s.emergency || riskStatus === 'CRITICAL'} onClick={() => { panic(); window.location.href = 'tel:911' }}>{s.emergency || riskStatus === 'CRITICAL' ? 'MODO DE EMERGENCIA ACTIVO' : emergencyRequested ? 'EMERGENCIA SOLICITADA' : 'SOS / NECESITO AYUDA'}</button>
      {emergencyMessage && <p role="status">{emergencyMessage}</p>}
      <p><a href="tel:911">Emergencias: 911</a></p><p className="muted">El marcador abre 911; confirma la llamada en tu dispositivo. No se notifica automáticamente a las autoridades.</p>
    </section>}

    <div className="basic-status" aria-label="Estado de seguimiento">
      <span><small>{demo ? 'GPS DEMO' : 'GPS'}</small><strong>{s.stopPending ? 'Detenido' : demo && !demo.gpsAvailable ? 'No disponible' : !demo && !s.acquiring ? 'Pausado' : point?.accuracy == null ? 'Sin precisión' : '±' + number(point.accuracy) + ' m'}</strong></span>
      <span><small>RED</small><strong className={'network ' + s.network}>{s.network}</strong></span>
      <span><small>WEBSOCKET</small><strong className={s.wsConnected ? 'connection-online' : 'connection-pending'}>{s.wsConnected ? 'LIVE' : 'Reconectando…'}</strong></span>
    </div>
    {!s.stopPending && !demo && !s.acquiring && <div className="notice resume-notice"><p>La adquisición está pausada. Confirma para volver a solicitar GPS.</p><button className="secondary full" disabled={s.busy || !!s.storageError} onClick={resume}>Reanudar GPS</button></div>}
    {demo && !demo.gpsAvailable && <p className="notice" role="status">Pérdida GPS simulada. Puedes restaurarlo en Modo demo.</p>}

    <div className="secondary-sections">
      {s.journey?.status === 'ACTIVE' && !s.stopPending && <MonitorSharing key={s.journey.journey_id} journeyId={s.journey.journey_id} routePlan={routePlan}/>}
      <details className="disclosure technical-details">
        <summary>Detalles técnicos <span className="summary-hint">GPS, telemetría y ACK</span></summary>
        <div className="disclosure-body">
          <p className="journey-reference"><span>ID DEL RECORRIDO</span><code>{s.journey?.journey_id}</code></p>
          {routePlan && <p className="muted">Dirección de destino: {routePlan.destinationAddress}</p>}
          <section className="location-panel">
            <div className="section-title"><h2>Ubicación actual</h2><span className="badge">{demo ? 'GPS DEMO' : 'GPS REAL'}</span></div>
            <div className="coordinates"><div><label>LATITUD</label><strong>{number(currentPosition?.lat, 6)}</strong></div><div><label>LONGITUD</label><strong>{number(currentPosition?.lng, 6)}</strong></div></div>
            <p className="muted">{demo ? 'Posición de simulación. Métricas del último punto adquirido abajo.' : point ? new Date(point.timestamp).toLocaleString('es-MX') : 'Esperando una ubicación del dispositivo…'}</p>
          </section>
          <div className="metrics">{[
            ['Velocidad', point?.speed == null ? null : point.speed * 3.6, 'km/h', 1],
            ['Precisión GPS', point?.accuracy, 'm', 0], ['Batería', point?.battery, '%', 0],
            ['Latencia HTTP', s.latency, 'ms', 0],
          ].map(([label, value, unit, digits]) => <article className="metric" key={String(label)}><label>{label}</label><strong>{number(value as number | null, digits as number)} <small>{value == null ? '' : unit}</small></strong></article>)}</div>
          <section className="details">
            <div><span>Frecuencia actual</span><strong data-testid="interval">{s.interval} s</strong></div>
            <div><span>WebSocket</span><strong className={s.wsConnected ? 'connection-online' : 'connection-pending'}>{s.wsConnected ? 'Conectado' : 'Reconectando…'}</strong></div>
            <div><span>Último envío confirmado</span><strong>{s.lastSent ? new Date(s.lastSent).toLocaleTimeString('es-MX') : 'Pendiente'}</strong></div>
            <div><span>Red</span><strong>{s.network}</strong></div>
          </section>
          {s.lastAck && <p className="ack" role="status">ACK · {s.lastAck}</p>}
          <h3>Razones de riesgo</h3><p className="muted">{s.risk?.reasons.join(' · ') || 'El backend evalúa la telemetría recibida.'}</p>
          <p className="footnote">{demo ? 'SIMULACIÓN: posición, precisión y velocidad sintéticas; riesgo, red, batería y ACK provienen del flujo existente.' : 'GPS real. Batería y velocidad pueden no estar disponibles en tu navegador. El GPS no está garantizado en segundo plano.'}</p>
        </div>
      </details>

      <details className="disclosure map-layers">
        <summary>Capas del mapa <span className="summary-hint">Qué quieres ver</span></summary>
        <div className="disclosure-body">
          <fieldset className="layer-options"><legend className="visually-hidden">Visibilidad de capas</legend>
            <label><input type="checkbox" checked={layers.route} onChange={event => setLayers(value => ({ ...value, route: event.target.checked }))}/>Ruta planeada <i className="map-dot"/></label>
            <label><input type="checkbox" checked={layers.trace} onChange={event => setLayers(value => ({ ...value, trace: event.target.checked }))}/>Trayectoria <i className="map-dot trace"/></label>
            <label><input type="checkbox" checked={layers.cameras} onChange={event => setLayers(value => ({ ...value, cameras: event.target.checked }))}/>Cámara del dataset · hasta 500 m</label>
            {demo && <label><input type="checkbox" checked={layers.zones} onChange={event => setLayers(value => ({ ...value, zones: event.target.checked }))}/>Zonas contextuales DEMO</label>}

          </fieldset>
          <p className="trace-legend">Turquesa: ruta planeada · Violeta: trayectoria {demo ? 'DEMO' : actualTrace.some(p => p.source === 'DEMO') ? 'mixta real/DEMO' : 'real'}</p>
          {(demo || layers.cameras) && <div className="demo-context">
            {layers.cameras && <details><summary>Cámara del dataset · información de los puntos</summary>
              <p>Información proveniente del dataset.</p>
              {safetyCameras.length ? <ul>{safetyCameras.map(camera => <li key={camera.id}><strong>{camera.id} · {Math.round(camera.distance_m!)} m</strong><br/>Cámara del dataset{camera.hasHelpButton && <><br/>Botón de auxilio</>}{camera.hasSpeaker && <><br/>Altavoz</>}</li>)}</ul> : <p>No hay cámaras del dataset dentro de 500 m de la posición disponible.</p>}
            </details>}
            {demo && (
              <details><summary>ESCENARIO ESTADÍSTICO DEMO</summary><p>Amarillo: incidencia contextual DEMO media.<br/>Rojo: incidencia contextual DEMO alta.</p>
              <ul>{riskZones.map(zone => <li key={zone.zone_id}><strong>{zone.zone_id} · {zone.severity === 'RED' ? 'ROJA' : 'AMARILLA'}</strong> · Incidentes del escenario: {zone.incident_count} · {zone.severity === 'RED' ? 'Percentil superior' : 'Rango intermedio del dataset'}</li>)}</ul>
              </details>
            )}
          </div>}
        </div>
      </details>

      {!s.stopPending && <details className="disclosure demo-disclosure">
        <summary>Modo demo <span className="summary-hint">{demo ? 'SIMULACIÓN ACTIVA' : 'Opcional'}</span></summary>
        <div className="disclosure-body">{demo ? <DemoControls state={demo} change={changeDemo} exit={exitDemo}/> : <>
          <p className="muted">Simula movimiento y escenarios durante este recorrido.</p>
          <button className="secondary full" disabled={!routePlan?.path.length || s.busy || !s.acquiring} onClick={activateDemo}>Activar modo demo</button>
        </>}</div>
      </details>}
    </div>

    {!s.stopPending && <section className="journey-actions journey-finish" aria-label="Finalizar acompañamiento">
      <button className="secondary full" disabled={s.busy} onClick={stop}>Finalizar recorrido</button>
    </section>}
  </div>
}

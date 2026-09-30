import { useState } from 'react'
import { JourneyMap } from '../components/JourneyMap'
import { DemoControls } from '../components/DemoControls'
import { deviationLabel } from '../services/demoScenario'
import type { JourneyState } from '../services/telemetry'
import type { Coordinate, DemoState, RiskZone, RoutePlan, SafetyCamera, TracePoint } from '../types'

const number = (value: number | null | undefined, digits = 0) => value == null ? 'No disponible' : value.toFixed(digits)
const distance = (meters: number) => meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toLocaleString('es-MX', { maximumFractionDigits: 1 })} km`
const duration = (seconds: number) => `${Math.max(1, Math.ceil(seconds / 60))} min aprox.`

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
        safetyCameras={demo && layers.cameras ? safetyCameras : undefined}
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
      <button className={'panic full ' + riskStatus} disabled={emergencyRequested || s.emergency || riskStatus === 'CRITICAL'} onClick={panic}>{s.emergency || riskStatus === 'CRITICAL' ? 'MODO DE EMERGENCIA ACTIVO' : emergencyRequested ? 'EMERGENCIA SOLICITADA' : 'SOS / NECESITO AYUDA'}</button>
      {emergencyMessage && <p role="status">{emergencyMessage}</p>}
      <p className="muted">No llama al 911 ni notifica automáticamente a autoridades.</p>
    </section>}

    <div className="basic-status" aria-label="Estado de seguimiento">
      <span><small>{demo ? 'GPS DEMO' : 'GPS'}</small><strong>{s.stopPending ? 'Detenido' : demo && !demo.gpsAvailable ? 'No disponible' : !demo && !s.acquiring ? 'Pausado' : point?.accuracy == null ? 'Sin precisión' : '±' + number(point.accuracy) + ' m'}</strong></span>
      <span><small>RED</small><strong className={'network ' + s.network}>{s.network}</strong></span>
      <span><small>WEBSOCKET</small><strong className={s.wsConnected ? 'connection-online' : 'connection-pending'}>{s.wsConnected ? 'LIVE' : 'Reconectando…'}</strong></span>
    </div>
    {!s.stopPending && !demo && !s.acquiring && <div className="notice resume-notice"><p>La adquisición está pausada. Confirma para volver a solicitar GPS.</p><button className="secondary full" disabled={s.busy || !!s.storageError} onClick={resume}>Reanudar GPS</button></div>}
    {demo && !demo.gpsAvailable && <p className="notice" role="status">Pérdida GPS simulada. Puedes restaurarlo en Modo demo.</p>}

    <div className="secondary-sections">
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
            {demo && <>
              <label><input type="checkbox" checked={layers.cameras} onChange={event => setLayers(value => ({ ...value, cameras: event.target.checked }))}/>C5 DEMO · hasta 500 m</label>
              <label><input type="checkbox" checked={layers.zones} onChange={event => setLayers(value => ({ ...value, zones: event.target.checked }))}/>Zonas contextuales DEMO</label>
            </>}
          </fieldset>
          <p className="trace-legend">Turquesa: ruta planeada · Violeta: trayectoria {demo ? 'DEMO' : actualTrace.some(p => p.source === 'DEMO') ? 'mixta real/DEMO' : 'real'}</p>
          {demo && <div className="demo-context">
            <details><summary>C5 DEMO · información de los puntos</summary>
              <p>Infraestructura de SIMULACIÓN.</p>
              {safetyCameras.length ? <ul>{safetyCameras.map(camera => <li key={camera.id}><strong>{camera.id} · {Math.round(camera.distance_m!)} m</strong><br/>Videovigilancia — SIMULACIÓN{camera.hasHelpButton && <><br/>Botón de auxilio — SIMULACIÓN</>}{camera.hasSpeaker && <><br/>Altavoz — SIMULACIÓN</>}</li>)}</ul> : <p>No hay puntos DEMO dentro de 500 m de la posición disponible.</p>}
            </details>
            <details><summary>ESCENARIO ESTADÍSTICO DEMO</summary><p>Amarillo: incidencia contextual DEMO media.<br/>Rojo: incidencia contextual DEMO alta.</p>
              <ul>{riskZones.map(zone => <li key={zone.zone_id}><strong>{zone.zone_id} · {zone.severity === 'RED' ? 'ROJA' : 'AMARILLA'}</strong> · Incidentes del escenario: {zone.incident_count} · {zone.severity === 'RED' ? 'Percentil superior' : 'Rango intermedio del dataset'}</li>)}</ul>
            </details>
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

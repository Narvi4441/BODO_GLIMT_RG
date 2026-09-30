import { JourneyMap } from '../components/JourneyMap'
import type { JourneyState } from '../services/telemetry'
import type { RoutePlan } from '../types'

const number = (value: number | null | undefined, digits = 0) => value == null ? 'No disponible' : value.toFixed(digits)
const distance = (meters: number) => meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toLocaleString('es-MX', { maximumFractionDigits: 1 })} km`
const duration = (seconds: number) => `${Math.max(1, Math.ceil(seconds / 60))} min aprox.`

export function ActiveJourney({ state: s, routePlan, stop, resume }: {
  state: JourneyState
  routePlan: RoutePlan | null
  stop: () => void
  resume: () => void
}) {
  const point = s.point
  const riskStatus = s.risk?.status || 'UNKNOWN'
  return <div className="active-page">
    <div className="page-intro active-heading">
      <span className="eyebrow">TU RECORRIDO</span>
      <h1>{s.stopPending ? 'Finalizando recorrido' : 'Contigo, en movimiento.'}</h1>
      <span className={`activity-badge ${s.acquiring && !s.stopPending ? 'live' : ''}`}><i/>{s.stopPending ? 'Cierre pendiente' : s.acquiring ? 'GPS activo' : 'GPS pausado'}</span>
    </div>

    <section className="map-section" aria-label="Mapa del recorrido">
      <JourneyMap
        currentPosition={point ? { lat: point.latitude, lng: point.longitude } : null}
        origin={routePlan?.origin}
        destination={routePlan?.destination}
        path={routePlan?.path}
      />
    </section>

    {routePlan ? <section className="panel active-destination">
      <span className="step-label">TU DESTINO</span>
      <h2>{routePlan.destinationName}</h2>
      <p className="muted">{routePlan.destinationAddress}</p>
      <div className="route-metrics">
        <div><span>Distancia planificada</span><strong>{distance(routePlan.distance_m)}</strong></div>
        <div><span>Tiempo estimado inicial</span><strong>{duration(routePlan.duration_s)}</strong></div>
      </div>
      <p className="planning-hint">Estimación al calcular la ruta; no indica tiempo ni distancia restantes.</p>
    </section> : <p className="notice route-unavailable" role="status">Ruta planificada no disponible después de esta recarga.</p>}

    {s.stopPending && <section className="notice closing-notice" role="status">
      <h2>GPS detenido · cierre pendiente</h2>
      <p>Se enviarán primero los datos pendientes y después el cierre al backend. Puedes dejar esta pantalla abierta para sincronizar.</p>
    </section>}

    <section className={`panel risk ${riskStatus}`} aria-label="Estado de riesgo">
      <div><span className="eyebrow">ESTADO DE RIESGO</span><h2>{s.risk?.status || 'ESPERANDO DATOS'}</h2></div>
      <div className="risk-score"><strong>{s.risk?.score ?? '—'}</strong><small>RISK SCORE / 100</small></div>
      <p>{s.risk?.reasons.join(' · ') || 'El backend evalúa la telemetría recibida.'}</p>
      {s.emergency && <div className="emergency-notice" role="status"><strong>MODO DE EMERGENCIA</strong><p>Frecuencia prioritaria activada. El score y el estado de riesgo mostrados siguen siendo los del backend.</p></div>}
    </section>

    <section className="panel location-panel">
      <div className="section-title"><h2>Ubicación actual</h2><span className="badge">GPS REAL</span></div>
      <div className="coordinates"><div><label>LATITUD</label><strong>{number(point?.latitude, 6)}</strong></div><div><label>LONGITUD</label><strong>{number(point?.longitude, 6)}</strong></div></div>
      <p className="muted">{point ? new Date(point.timestamp).toLocaleString('es-MX') : 'Esperando una ubicación del dispositivo…'}</p>
    </section>

    <div className="section-title telemetry-heading"><h2>Telemetría y conexión</h2><span className={`network ${s.network}`}><i/>{s.network}</span></div>
    <div className="metrics">{[
      ['Velocidad', point?.speed == null ? null : point.speed * 3.6, 'km/h', 1],
      ['Precisión GPS', point?.accuracy, 'm', 0], ['Batería', point?.battery, '%', 0],
      ['Latencia HTTP', s.latency, 'ms', 0],
    ].map(([label, value, unit, digits]) => <article className="panel metric" key={String(label)}><label>{label}</label><strong>{number(value as number | null, digits as number)} <small>{value == null ? '' : unit}</small></strong></article>)}</div>
    <section className="panel details">
      <div><span>Frecuencia actual</span><strong data-testid="interval">{s.interval} s</strong></div>
      <div><span>WebSocket</span><strong className={s.wsConnected ? 'connection-online' : 'connection-pending'}>{s.wsConnected ? 'Conectado' : 'Reconectando…'}</strong></div>
      <div><span>Último envío confirmado</span><strong>{s.lastSent ? new Date(s.lastSent).toLocaleTimeString('es-MX') : 'Pendiente'}</strong></div>
      <div><span>Red</span><strong>{s.network}</strong></div>
    </section>
    {s.lastAck && <p className="ack" role="status">ACK · {s.lastAck}</p>}

    {!s.stopPending && <section className="journey-actions" aria-label="Acciones del recorrido">
      {!s.acquiring && <div className="notice"><p>La adquisición está pausada. Confirma para volver a solicitar GPS.</p><button className="secondary full" disabled={s.busy || !!s.storageError} onClick={resume}>Reanudar GPS</button></div>}
      <button className="danger full" disabled={s.busy} onClick={stop}>Finalizar recorrido</button>
    </section>}
    <p className="journey-reference"><span>ID DEL RECORRIDO</span><code>{s.journey?.journey_id}</code></p>
    <p className="footnote">No se simulan sensores. Batería y velocidad pueden no estar disponibles en tu navegador. El GPS no está garantizado en segundo plano.</p>
  </div>
}

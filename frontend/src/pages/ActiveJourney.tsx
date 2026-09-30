import type { JourneyState } from '../services/telemetry'

const number = (value: number | null | undefined, digits = 0) => value == null ? 'No disponible' : value.toFixed(digits)
export function ActiveJourney({ state: s, stop, resume }: { state: JourneyState; stop: () => void; resume: () => void }) {
  const status = s.emergency ? 'CRITICAL' : s.risk?.status
  const point = s.point
  return <>
    <div className="page-intro"><span className="eyebrow">TRAYECTO PROTEGIDO</span><h1>{s.stopPending ? 'Finalizando trayecto' : 'Estamos contigo.'}</h1><code>{s.journey?.journey_id}</code></div>
    {s.stopPending ? <section className="panel"><h2>GPS detenido</h2><p>Se enviarán primero los datos pendientes y después el cierre al backend. Puedes dejar esta pantalla abierta para sincronizar.</p></section> : <>
      <section className={`panel risk ${status || 'UNKNOWN'}`}>
        <div><span className="eyebrow">{s.emergency ? 'MODO DE EMERGENCIA' : 'ESTADO DEL BACKEND'}</span><h2>{status || 'ESPERANDO DATOS'}</h2></div>
        <div className="risk-score"><strong>{s.risk?.score ?? '—'}</strong><small>RISK SCORE / 100</small></div>
        <p>{s.emergency ? 'Frecuencia prioritaria activada. El score mostrado sigue siendo el del backend.' : s.risk?.reasons.join(' · ') || 'El backend evalúa la telemetría recibida.'}</p>
      </section>
      {!s.acquiring && <div className="notice"><p>La adquisición está pausada. Confirma para volver a solicitar GPS.</p><button className="secondary" disabled={s.busy || !!s.storageError} onClick={resume}>Reanudar GPS</button></div>}
      <section className="panel location-panel"><div className="section-title"><h2>◎ Ubicación actual</h2><span className="badge">GPS</span></div><div className="coordinates"><div><label>LATITUD</label><strong>{number(point?.latitude, 6)}</strong></div><div><label>LONGITUD</label><strong>{number(point?.longitude, 6)}</strong></div></div><p className="muted">{point ? new Date(point.timestamp).toLocaleString('es-MX') : 'Esperando una ubicación del dispositivo…'}</p></section>
      <div className="metrics">{[
        ['Velocidad', point?.speed == null ? null : point.speed * 3.6, 'km/h', 1],
        ['Precisión GPS', point?.accuracy, 'm', 0], ['Batería', point?.battery, '%', 0],
        ['Latencia HTTP', s.latency, 'ms', 0],
      ].map(([label, value, unit, digits]) => <article className="panel metric" key={String(label)}><label>{label}</label><strong>{number(value as number | null, digits as number)} <small>{value == null ? '' : unit}</small></strong></article>)}</div>
      <section className="panel details"><div><span>Frecuencia actual</span><strong data-testid="interval">{s.interval} s</strong></div><div><span>WebSocket</span><strong>{s.wsConnected ? 'Conectado' : 'Reconectando…'}</strong></div><div><span>Último envío confirmado</span><strong>{s.lastSent ? new Date(s.lastSent).toLocaleTimeString('es-MX') : 'Pendiente'}</strong></div><div><span>Red</span><strong>{s.network}</strong></div></section>
      {s.lastAck && <p className="ack" role="status">ACK · {s.lastAck}</p>}
      <button className="danger full" disabled={s.busy} onClick={stop}>Finalizar trayecto</button>
    </>}
    <p className="footnote">No se simulan sensores. Batería y velocidad pueden no estar disponibles en tu navegador. El GPS no está garantizado en segundo plano.</p>
  </>
}

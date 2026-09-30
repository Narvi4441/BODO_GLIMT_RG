import { useEffect, useState } from 'react'
import { JourneyMap } from '../components/JourneyMap'
import { api, ApiError } from '../services/api'
import type { MonitorSnapshot } from '../types'

export function MonitorPage({ token }: { token: string }) {
  const [data, setData] = useState<MonitorSnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'active' | 'unavailable' | 'error'>('loading')

  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'referrer'
    meta.content = 'no-referrer'
    document.head.appendChild(meta)
    const abort = new AbortController()
    let disposed = false, polling = false, ended = false
    let timer: ReturnType<typeof setInterval> | undefined
    setData(null)
    setStatus('loading')
    async function poll() {
      if (disposed || polling || ended) return
      polling = true
      try {
        const snapshot = await api.monitor(token, abort.signal)
        if (disposed || ended) return
        setData(previous => ({ ...snapshot,
          planned_path: previous && JSON.stringify(previous.planned_path) === JSON.stringify(snapshot.planned_path)
            ? previous.planned_path : snapshot.planned_path,
        }))
        setStatus('active')
      } catch (error) {
        if (disposed) return
        // No retener el mapa cuando no se puede confirmar que el acceso sigue vigente.
        setData(null)
        if (error instanceof ApiError && [410, 404, 401].includes(error.status)) {
          ended = true
          clearInterval(timer)
          setStatus('unavailable')
        } else setStatus('error')
      } finally { polling = false }
    }
    if (!token) { ended = true; setStatus('unavailable') }
    else { timer = setInterval(() => void poll(), 2000); void poll() }
    return () => { disposed = true; clearInterval(timer); abort.abort(); meta.remove() }
  }, [token])

  return <div className="app-shell monitor-shell">
    <header><span className="brand"><img src="/icon.svg" alt=""/><span>GUARDIAN <small>MONITOR</small></span></span>
      {status === 'active' && <span className="monitor-live"><i/>EN VIVO</span>}
    </header>
    <main className="monitor-page">
      {status === 'unavailable' ? <section className="monitor-message" role="status"><h1>Seguimiento no disponible</h1><p>El recorrido terminó o el enlace ya no es válido.</p></section>
        : status === 'loading' ? <p className="notice" role="status">Confirmando acceso al recorrido…</p>
        : status === 'error' ? <section className="monitor-message" role="status"><h1>No se pudo confirmar el seguimiento</h1><p>Comprobando la conexión. La ubicación permanece oculta.</p></section>
        : data && <>
          <section className="map-section" aria-label="Mapa del recorrido compartido"><JourneyMap currentPosition={data.current_position} destination={data.destination} plannedPath={data.planned_path}/></section>
          {!data.current_position && <p className="notice">Esperando la primera ubicación del recorrido.</p>}
          <section className="active-route-strip"><span className="eyebrow">DESTINO</span><h1>{data.destination?.name || 'Destino no disponible'}</h1>{data.destination?.address && <p className="muted">{data.destination.address}</p>}</section>
          <section className={'panel monitor-risk ' + (data.risk_status || 'UNKNOWN')}><span className="eyebrow">RIESGO</span><h2>{data.risk_status || 'Esperando datos'} <small>{data.risk_score == null ? '' : `${data.risk_score} / 100`}</small></h2></section>
          <dl className="monitor-details">
            <div><dt>Desviación</dt><dd>{data.route_deviation_m == null ? 'No disponible' : `${Math.round(data.route_deviation_m)} m`}</dd></div>
            <div><dt>Conexión del viajero</dt><dd>{data.network_status || 'No disponible'}</dd></div>
            <div><dt>Última actualización</dt><dd>{data.updated_at ? new Date(data.updated_at).toLocaleString('es-MX') : 'Esperando datos'}</dd></div>
          </dl>
          <p className="footnote">Solo lectura durante este recorrido. La ubicación corresponde a la última telemetría recibida y puede incluir simulación si el viajero activa modo demo.</p>
        </>}
    </main>
  </div>
}

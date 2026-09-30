import { useEffect, useRef, useState } from 'react'
import { JourneyMap } from '../components/JourneyMap'
import { DestinationSearch } from '../components/DestinationSearch'
import type { JourneyState } from '../services/telemetry'
import type { Coordinate, Destination, RoutePlan, SavedEvidence, User } from '../types'

interface Props {
  state: JourneyState; user: User | null;
  origin: Coordinate | null; destination: Destination | null; routePlan: RoutePlan | null;
  planning: boolean; planningError: string; canPlan: boolean; canStart: boolean;
  onOriginChange: (value: Coordinate | null) => void;
  onDestinationChange: (value: Destination | null) => void;
  onMapReady: (ready: boolean) => void; onPlacesReady: (ready: boolean) => void;
  calculateRoute: () => void; start: () => void; account: () => void;
  savedRoutes: SavedEvidence[]; deleteEvidence: (id: string) => void;
}

export function HomePage({ state, user, origin, destination, routePlan, planning, planningError,
  canPlan, canStart, onOriginChange, onDestinationChange, onMapReady, onPlacesReady,
  calculateRoute, start, account, savedRoutes, deleteEvidence }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = savedRoutes.find(item => item.evidence_id === selectedId && item.expires_at > Date.now())
  const [gpsBusy, setGpsBusy] = useState(false)
  const [gpsError, setGpsError] = useState('')
  const gpsRequest = useRef(0)
  useEffect(() => () => { gpsRequest.current++ }, [])
  function locate() {
    if (!user || gpsBusy || state.busy) return
    onOriginChange(null)
    setGpsError('')
    if (!window.isSecureContext || !navigator.geolocation) {
      setGpsError('La ubicación requiere HTTPS y un navegador con GPS disponible.')
      return
    }
    setGpsBusy(true)
    const request = ++gpsRequest.current
    navigator.geolocation.getCurrentPosition(position => {
      if (request !== gpsRequest.current) return
      setGpsBusy(false)
      const { latitude: lat, longitude: lng } = position.coords
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        setGpsError('No se obtuvo una ubicación válida. Intenta de nuevo.')
        return
      }
      onOriginChange({ lat, lng })
    }, error => {
      if (request !== gpsRequest.current) return
      setGpsBusy(false)
      setGpsError(error.code === 1 ? 'Permiso de ubicación denegado. Habilítalo en los ajustes del navegador.'
        : error.code === 2 ? 'No fue posible obtener tu ubicación. Comprueba el GPS del dispositivo.'
        : 'La ubicación tardó demasiado. Intenta de nuevo con mejor señal.')
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 })
  }
  return <div className="planning-page">
    <section className="planning-heading">
      <div><span className="eyebrow">TU SIGUIENTE RECORRIDO</span><h1>Muévete con confianza.</h1></div>
      <div className="planner-identity"><span>{user ? user.nombre_completo : 'Inicia sesión para planificar'}</span><button className="text-button" onClick={account} disabled={state.busy}>{user ? 'Mi cuenta' : 'Acceder'}</button></div>
    </section>
    <section className="panel evidence-history"><h2>Recorridos guardados — 24 h</h2><p>Evidencia temporal local. Se elimina al vencer su vigencia cuando la aplicación vuelve a acceder al almacenamiento.</p>
      {!savedRoutes.length && <p className="muted">No hay instantáneas vigentes.</p>}
      {savedRoutes.filter(item => item.expires_at > Date.now()).map(item => <article key={item.evidence_id}>
        <h3>{item.destination?.name || 'Sin destino disponible'}</h3>
        <p>{new Date(item.saved_at).toLocaleString('es-MX')} · Restan {Math.max(1, Math.ceil((item.expires_at - Date.now()) / 60000))} min</p>
        <p>Riesgo máximo: {item.max_risk_status ?? 'Sin datos'} · {item.max_risk_score ?? '—'} / 100 · {item.deviation_events.length ? 'Con desviación' : 'Sin desviación registrada'}</p>
        <p>{item.actual_trace.some(point => point.source === 'DEMO') ? 'Contiene SIMULACIÓN DE TELEMETRÍA' : 'Trayectoria real'}</p>
        <button className="text-button" onClick={() => setSelectedId(item.evidence_id)}>VER</button><button className="text-button" onClick={() => deleteEvidence(item.evidence_id)}>ELIMINAR AHORA</button>
      </article>)}
      {selected && <div className="evidence-view"><h3>Evidencia temporal local</h3><p>{selected.destination?.name ?? 'Destino no disponible'}</p>
        <JourneyMap destination={selected.destination} origin={selected.planned_path[0]} currentPosition={selected.actual_trace.at(-1)} plannedPath={selected.planned_path} actualTrace={selected.actual_trace}/>
        <p>Inicio de traza: {selected.actual_trace[0] ? new Date(selected.actual_trace[0].timestamp).toLocaleString('es-MX') : 'Sin puntos'}<br/>Guardado: {new Date(selected.saved_at).toLocaleString('es-MX')}<br/>Vence: {new Date(selected.expires_at).toLocaleString('es-MX')}</p>
        <p>Máximo: {selected.max_risk_status ?? 'Sin datos'} · {selected.max_risk_score ?? '—'}. Desviaciones: {selected.deviation_events.length}.</p>
        <p>Turquesa: ruta planeada. Violeta: traza {selected.actual_trace.some(point => point.source === 'DEMO') ? 'con SIMULACIÓN' : 'real'}.</p>
        <details><summary>Desviaciones registradas</summary><ul>{selected.deviation_events.map((event, i) => <li key={i}>{new Date(event.timestamp).toLocaleTimeString('es-MX')} · {Math.round(event.distance_m)} m · {event.source}</li>)}</ul></details>
        {selected.incident_note && <p>{selected.incident_note}</p>}
        <button className="text-button" onClick={() => setSelectedId(null)}>Cerrar evidencia</button>
      </div>}
    </section>
    <section className="map-section" aria-label="Mapa de planificación">
      <JourneyMap currentPosition={origin} origin={origin} destination={destination} path={routePlan?.path} onReady={onMapReady}/>
    </section>
    <section className="panel planning-location">
      <div className="location-summary"><span className="step-label">01 · TU PUNTO DE PARTIDA</span><h2>{origin ? 'Ubicación actual lista' : 'Ubícate para comenzar'}</h2>
        <p className="muted">{origin ? `${origin.lat.toFixed(6)}, ${origin.lng.toFixed(6)}` : 'Usa el GPS de tu teléfono para definir el origen.'}</p></div>
      <button className="secondary full" onClick={locate} disabled={!user || gpsBusy || state.busy}>{gpsBusy ? 'Obteniendo ubicación…' : origin ? 'Actualizar mi ubicación' : 'Usar mi ubicación'}</button>
      {gpsError && <p className="notice" role="alert">{gpsError}</p>}
    </section>
    <section className="panel planning-card">
      <span className="step-label">02 · ELIGE TU DESTINO</span><h2>¿A dónde vas?</h2>
      <DestinationSearch onChange={onDestinationChange} onReady={onPlacesReady} disabled={!user || state.busy}/>
      {destination && <div className="destination-card"><span className="eyebrow">DESTINO SELECCIONADO</span><h3>{destination.name}</h3><p>{destination.address}</p></div>}
      <button className="secondary full" disabled={!canPlan || gpsBusy} onClick={calculateRoute}>{planning ? 'Calculando ruta…' : 'Calcular ruta'}</button>
      {planningError && <p className="notice" role="alert">{planningError}</p>}
    </section>
    <section className="panel route-summary" aria-live="polite">
      <span className="step-label">03 · REVISA Y COMIENZA</span>
      {routePlan ? <><h2>{routePlan.destinationName}</h2><p className="muted">{routePlan.destinationAddress}</p>
        <div className="route-metrics"><div><span>Distancia</span><strong>{routePlan.distance_m < 1000 ? `${Math.round(routePlan.distance_m)} m` : `${(routePlan.distance_m / 1000).toFixed(1)} km`}</strong></div><div><span>Tiempo estimado</span><strong>{Math.ceil(routePlan.duration_s / 60)} min <small>aprox.</small></strong></div></div>
        <p className="planning-hint">Ruta en automóvil. La estimación corresponde al momento del cálculo.</p>
      </> : <><h2>Tu ruta, antes de salir.</h2><p className="muted">Obtén tu ubicación, selecciona un destino y calcula la ruta para comenzar.</p></>}
      <div className="route-actions"><button className="primary full" disabled={!canStart || gpsBusy} onClick={start}>{state.busy ? 'Obteniendo GPS e iniciando…' : 'Iniciar recorrido'}</button></div>
      <p className="planning-hint">{!user ? 'Inicia sesión para preparar tu recorrido.' : 'Al iniciar se confirma tu GPS y comienza el seguimiento del recorrido.'}</p>
    </section>
    <p className="footnote">Mantén GUARDIAN visible durante el recorrido. El teléfono puede suspender el GPS en segundo plano.</p>
  </div>
}

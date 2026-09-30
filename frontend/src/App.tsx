import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, accessToken, ACCESS_TOKEN_KEY } from './services/api'
import { useJourney } from './hooks/useJourney'
import { guardian } from './services/telemetry'
import { HomePage } from './pages/HomePage'
import { ActiveJourney } from './pages/ActiveJourney'
import { AuthPage } from './pages/AuthPage'
import { CheckInModal } from './components/CheckInModal'
import { InstallPrompt } from './components/InstallPrompt'
import { demoPosition, distanceMeters, pathLength, routeDeviation, scenarioInfrastructure } from './services/demoScenario'
import { evidence24h } from './services/evidence24h'
import type { Coordinate, DemoState, Destination, EvidenceSnapshot, RoutePlan, SavedEvidence, TracePoint, User } from './types'

function validCoordinate(value: Coordinate | null | undefined): value is Coordinate {
  return !!value && Number.isFinite(value.lat) && Number.isFinite(value.lng)
    && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180
}

function lightPreference() {
  try { return localStorage.getItem('guardian-theme') === 'light' } catch { return false }
}
export default function App() {
  const s = useJourney()
  const [user, setUser] = useState<User | null>(null)
  const [account, setAccount] = useState(false)
  const [error, setError] = useState('')
  const [light, setLight] = useState(lightPreference)
  const [restoring, setRestoring] = useState(() => !!accessToken())
  const [authError, setAuthError] = useState('')
  const [restoreAttempt, setRestoreAttempt] = useState(0)
  const [origin, setOrigin] = useState<Coordinate | null>(null)
  const [destination, setDestination] = useState<Destination | null>(null)
  const [routePlan, setRoutePlan] = useState<RoutePlan | null>(null)
  const [planning, setPlanning] = useState(false)
  const [planningError, setPlanningError] = useState('')
  const [mapsReady, setMapsReady] = useState(false)
  const [placesReady, setPlacesReady] = useState(false)
  const [demo, setDemo] = useState<DemoState | null>(null)
  const demoRef = useRef(demo)
  demoRef.current = demo
  const [actualTrace, setActualTrace] = useState<TracePoint[]>([])
  const traceJourney = useRef<string | null>(null)
  const snapshot = useRef<EvidenceSnapshot | null>(null)
  const [savedRoutes, setSavedRoutes] = useState<SavedEvidence[]>([])
  const [evidenceError, setEvidenceError] = useState('')
  const [evidenceMessage, setEvidenceMessage] = useState('')
  const [savingEvidence, setSavingEvidence] = useState(false)
  const [incidentNote, setIncidentNote] = useState('')
  const [hasSnapshot, setHasSnapshot] = useState(false)
  const savedJourney = useRef<string | null>(null)
  const [emergencyMessage, setEmergencyMessage] = useState('')
  const emergencyRequest = useRef<{ journeyId: string; commandId: string | null } | null>(null)
  const lastDemoSend = useRef(0)
  const demoPoint = useMemo(() => demo?.gpsAvailable && routePlan ? demoPosition(routePlan.path, demo.distance, demo.offset) : null, [demo, routePlan])
  const currentPosition = demo ? demoPoint : s.point ? { lat: s.point.latitude, lng: s.point.longitude } : null
  const deviation = currentPosition && routePlan ? routeDeviation(currentPosition, routePlan.path) : null
  const infrastructure = useMemo(() => demo && routePlan ? scenarioInfrastructure(routePlan.path) : { cameras: [], zones: [] }, [!!demo, routePlan])
  const nearbyCameras = useMemo(() => currentPosition ? infrastructure.cameras.map(camera => ({ ...camera, distance_m: distanceMeters(currentPosition, camera) })).filter(camera => camera.distance_m <= 500) : [], [infrastructure, currentPosition?.lat, currentPosition?.lng])

  useEffect(() => { guardian.setRoutePath(routePlan?.path ?? []) }, [routePlan])
  const refreshEvidence = useCallback(async () => {
    try { setSavedRoutes(await evidence24h.list()); setEvidenceError('') }
    catch { setEvidenceError('No se pudo consultar la evidencia local de 24 h.') }
  }, [])
  useEffect(() => { void refreshEvidence() }, [refreshEvidence])
  useEffect(() => {
    const nextExpiry = Math.min(...savedRoutes.map(item => item.expires_at))
    const timer = setTimeout(() => void refreshEvidence(), Math.max(1, Math.min(60000, nextExpiry - Date.now() + 1)))
    return () => clearTimeout(timer)
  }, [savedRoutes, refreshEvidence])
  async function deleteEvidence(id: string) {
    try { await evidence24h.remove(id); await refreshEvidence() }
    catch { setEvidenceError('No se pudo eliminar la evidencia local.') }
  }
  async function saveEvidence() {
    if (!snapshot.current || savingEvidence || savedJourney.current === snapshot.current.journey_id) return
    const value = structuredClone(snapshot.current)
    setSavingEvidence(true)
    setEvidenceMessage('')
    try {
      await evidence24h.save({ ...value, incident_note: incidentNote.trim() || undefined })
      savedJourney.current = value.journey_id
      setEvidenceMessage('Instantánea guardada durante 24 horas. Su vigencia no se puede extender.')
      await refreshEvidence()
    } catch { setEvidenceError('No se pudo guardar la instantánea. Revisa el almacenamiento local.') }
    finally { setSavingEvidence(false) }
  }
  useEffect(() => {
    const journey = s.journey
    if (!journey || journey.status !== 'ACTIVE' || s.stopPending) return
    if (traceJourney.current !== journey.journey_id) {
      traceJourney.current = journey.journey_id
      setActualTrace([])
      setIncidentNote('')
      setEvidenceMessage('')
      setEmergencyMessage('')
      emergencyRequest.current = null
      snapshot.current = { journey_id: journey.journey_id, destination: null, planned_path: [], actual_trace: [], max_risk_score: null, max_risk_status: null, deviation_events: [] }
      setHasSnapshot(true)
    }
    const value = snapshot.current!
    if (routePlan) {
      value.destination = { ...routePlan.destination, name: routePlan.destinationName, address: routePlan.destinationAddress }
      value.planned_path = routePlan.path
    }
    if (s.risk) {
      value.max_risk_score = Math.max(value.max_risk_score ?? 0, s.risk.score)
      const statuses = ['NORMAL', 'PRECAUTION', 'ALERT', 'CRITICAL']
      if (statuses.indexOf(s.risk.status) > statuses.indexOf(value.max_risk_status ?? '')) value.max_risk_status = s.risk.status
    }
    if (!currentPosition || (!demo && s.point?.journey_id !== journey.journey_id)) return
    const source = demo ? 'DEMO' : 'REAL'
    const last = value.actual_trace.at(-1)
    if (!last || last.source !== source || distanceMeters(last, currentPosition) >= 3) {
      const point: TracePoint = { ...currentPosition, source, timestamp: demo ? new Date().toISOString() : s.point!.timestamp }
      value.actual_trace = [...value.actual_trace, point]
      setActualTrace(value.actual_trace)
      if (deviation !== null && deviation > 50) value.deviation_events = [...value.deviation_events, { ...point, distance_m: deviation }]
    }
  }, [s.journey, s.stopPending, s.risk, s.point, currentPosition?.lat, currentPosition?.lng, !!demo, routePlan, deviation])

  function activateDemo() {
    if (!routePlan?.path.length || s.busy || s.stopPending || !s.acquiring) return
    if (!window.confirm('El modo demo sustituirá temporalmente la posición GPS enviada durante la demostración.')) return
    guardian.setDemoMode(true)
    const value: DemoState = { distance: 0, moving: false, gpsAvailable: true, offset: 0 }
    demoRef.current = value
    setDemo(value)
    lastDemoSend.current = 0
  }
  function changeDemo(patch: Partial<DemoState>) {
    if (!demoRef.current) return
    const value = { ...demoRef.current, ...patch }
    demoRef.current = value
    setDemo(value)
  }
  function exitDemo(resume = true) {
    demoRef.current = null
    setDemo(null)
    guardian.setDemoMode(false)
    if (resume) void guardian.resume()
  }
  useEffect(() => {
    if (!demo || !routePlan || !s.journey || s.stopPending) return
    const path = routePlan.path, total = pathLength(path)
    const timer = setInterval(() => {
      const value = demoRef.current
      const state = guardian.snapshot()
      if (!value || !value.gpsAvailable || state.stopPending || !state.journey) return
      // Un solo reloj mueve el sensor; la frecuencia de envío sigue la orden del backend.
      const advance = value.moving ? Math.min(20, Math.max(1, total / 120)) : 0
      const next = { ...value, distance: Math.min(total, value.distance + advance) }
      if (next.distance >= total) next.moving = false
      demoRef.current = next
      setDemo(next)
      const position = demoPosition(path, next.distance, next.offset)
      if (position && Date.now() - lastDemoSend.current >= state.interval * 1000) {
        lastDemoSend.current = Date.now()
        void guardian.submitDemoPosition(position, next.moving ? advance : 0).catch(() => setError('No se pudo adquirir el punto demo.'))
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [!!demo, routePlan, s.journey?.journey_id, s.stopPending])
  useEffect(() => {
    if ((!s.journey || s.stopPending) && demoRef.current) exitDemo(false)
  }, [s.journey, s.stopPending])
  useEffect(() => () => {
    if (demoRef.current) {
      demoRef.current = null
      guardian.setDemoMode(false)
      void guardian.resume()
    }
    guardian.setRoutePath([])
  }, [])

  async function requestEmergency(expectedJourney?: string) {
    const state = guardian.snapshot(), journey = state.journey
    if (!journey || journey.status !== 'ACTIVE' || state.stopPending || (expectedJourney && journey.journey_id !== expectedJourney)) return
    if (emergencyRequest.current?.journeyId === journey.journey_id || state.emergency || state.risk?.status === 'CRITICAL') return
    emergencyRequest.current = { journeyId: journey.journey_id, commandId: null }
    setEmergencyMessage('Solicitando modo de emergencia...')
    try {
      const command = await api.sendCommand(journey.journey_id, journey.user_id)
      if (emergencyRequest.current?.journeyId !== journey.journey_id) return
      emergencyRequest.current.commandId = command.command_id
      setEmergencyMessage(`Orden ${command.command_id} enviada. Ejecución y ACK mediante WebSocket.`)
    } catch {
      // Un timeout HTTP no prueba que el servidor no haya creado la orden: no repetirla.
      setEmergencyMessage('No se pudo confirmar la solicitud. No se repite automáticamente para evitar duplicados. Revisa conexión y ACK.')
    }
  }
  async function resolveCheckIn(commandId: string, response: 'ok' | 'help' | 'timeout') {
    const state = guardian.snapshot()
    if (state.checkIn?.command_id !== commandId) return
    const journeyId = state.journey?.journey_id
    try {
      if (response === 'ok') await guardian.answerCheckIn(true)
      else {
        await guardian.failCheckIn(response === 'timeout' ? 'CHECK_IN_TIMEOUT' : 'USER_REQUESTED_HELP')
        if (journeyId) await requestEmergency(journeyId)
      }
    } catch { setError('No se pudo completar la respuesta del check-in. Revisa los ACK pendientes.') }
  }
  const planVersion = useRef(0)
  const previousJourney = useRef<string | undefined>(undefined)
  const invalidatePlan = useCallback(() => {
    planVersion.current++
    setRoutePlan(null)
    setPlanning(false)
    setPlanningError('')
  }, [])
  const changeOrigin = useCallback((value: Coordinate | null) => {
    invalidatePlan()
    setOrigin(value)
  }, [invalidatePlan])
  const changeDestination = useCallback((value: Destination | null) => {
    invalidatePlan()
    setDestination(value)
  }, [invalidatePlan])
  const clearPlanning = useCallback(() => {
    invalidatePlan()
    setOrigin(null)
    setDestination(null)
  }, [invalidatePlan])
  useEffect(() => { clearPlanning() }, [user?.id_usuario, clearPlanning])
  useEffect(() => {
    if (previousJourney.current && !s.journey) clearPlanning()
    previousJourney.current = s.journey?.journey_id
  }, [s.journey, clearPlanning])
  useEffect(() => () => { planVersion.current++ }, [])
  const canPlan = !!user && validCoordinate(origin) && validCoordinate(destination)
    && mapsReady && placesReady && !planning && !s.busy && s.network !== 'OFFLINE'
  const canStart = canPlan && !!routePlan && routePlan.path.length > 0
    && routePlan.origin.lat === origin?.lat && routePlan.origin.lng === origin?.lng
    && routePlan.destination.lat === destination?.lat && routePlan.destination.lng === destination?.lng
    && s.ready && window.isSecureContext && !s.storageError
  async function calculateRoute() {
    if (!canPlan || !origin || !destination) return
    const version = ++planVersion.current
    setRoutePlan(null)
    setPlanningError('')
    setPlanning(true)
    try {
      const target = { lat: destination.lat, lng: destination.lng }
      const result = await api.planRoute(origin, target)
      if (version !== planVersion.current) return
      if (!validCoordinate(result.origin) || !validCoordinate(result.destination)
          || result.origin.lat !== origin.lat || result.origin.lng !== origin.lng
          || result.destination.lat !== target.lat || result.destination.lng !== target.lng
          || !Number.isFinite(result.distance_m) || result.distance_m < 0
          || !Number.isFinite(result.duration_s) || result.duration_s < 0
          || !Array.isArray(result.path) || !result.path.length || !result.path.every(validCoordinate)) {
        throw new Error('La ruta recibida no es válida. Intenta calcularla de nuevo.')
      }
      setRoutePlan({ ...result, destinationName: destination.name, destinationAddress: destination.address })
    } catch (error) {
      if (version !== planVersion.current) return
      setRoutePlan(null)
      setPlanningError(error instanceof Error ? error.message : 'No fue posible calcular la ruta.')
    } finally {
      if (version === planVersion.current) setPlanning(false)
    }
  }
  useEffect(() => {
    if (!accessToken()) { setRestoring(false); return }
    let cancelled = false
    setRestoring(true)
    setAuthError('')
    void api.me().then(value => {
      if (!cancelled) setUser(value)
    }).catch(error => {
      if (cancelled) return
      if (error instanceof ApiError && error.status === 401) {
        try { localStorage.removeItem(ACCESS_TOKEN_KEY) }
        catch { setAuthError('No se pudo borrar la sesión del navegador.') }
        setUser(null)
        setAccount(true)
      } else {
        setAuthError(error instanceof Error ? error.message : 'No se pudo recuperar la sesión.')
      }
    }).finally(() => { if (!cancelled) setRestoring(false) })
    return () => { cancelled = true }
  }, [restoreAttempt])
  function logout() {
    try { localStorage.removeItem(ACCESS_TOKEN_KEY) }
    catch { setAuthError('No se pudo borrar la sesión. Revisa el almacenamiento del navegador.'); return }
    setUser(null)
    clearPlanning()
    setAuthError('')
    setAccount(true)
  }
  async function start() {
    if (!user) { setAccount(true); return }
    if (!canStart) return
    try { await guardian.start(String(user.id_usuario)) }
    catch { setError('El almacenamiento local no está disponible. Habilítalo para iniciar.') }
  }
  return <div className={`app-shell ${light ? 'light' : ''}`}>
    <header><a className="brand" href="/" aria-label="GUARDIAN Core inicio" onClick={event => { event.preventDefault(); setAccount(false) }}><img src="/icon.svg" alt=""/> <span>GUARDIAN <small>CORE</small></span></a><button className="theme" aria-label="Cambiar tema" onClick={() => { setLight(!light); localStorage.setItem('guardian-theme', light ? 'dark' : 'light') }}>{light ? '☾' : '☀'}</button></header>
    <main><div className="system-line"><span className={`network ${s.network}`}><i/>{s.network === 'OFFLINE' ? 'Sin conexión · OFFLINE' : s.network}</span><span>{s.acquiring ? 'TRAYECTO ACTIVO' : 'TELEMETRÍA URBANA'}</span></div>
      {demo && <div className="demo-banner" role="status">MODO DEMO — SIMULACIÓN DE TELEMETRÍA</div>}
      {!window.isSecureContext && <p className="notice" role="alert">Para usar GPS e instalar la PWA desde tu teléfono, abre esta página con HTTPS confiable.</p>}
      {(s.error || error) && <p className="notice" role="alert">{s.error || error}</p>}
      {s.gpsError && <p className="notice" role="alert">{s.gpsError}</p>}
      {s.storageError && <p className="notice" role="alert">{s.storageError}</p>}
      {authError && <p className="notice" role="alert">{authError} <button className="text-button" disabled={restoring} onClick={() => setRestoreAttempt(value => value + 1)}>Reintentar sesión</button></p>}
      {s.pending > 0 && <section className="buffer panel"><div><strong>{s.pending} pendientes</strong><p>Puntos GPS y confirmaciones guardados localmente.</p></div><button className="text-button" onClick={() => void guardian.sync()}>Reintentar</button><button className="text-button" onClick={() => void guardian.downloadPending().catch(() => setError('No se pudo exportar el buffer.'))}>Descargar</button></section>}
      {s.recovered > 0 && <p className="success" role="status">✓ {s.recovered} puntos recuperados y confirmados por el backend.</p>}
      {s.journey ? <ActiveJourney state={s} routePlan={routePlan} actualTrace={actualTrace} currentPosition={currentPosition} deviation={deviation} demo={demo} activateDemo={activateDemo} changeDemo={changeDemo} exitDemo={() => exitDemo()} safetyCameras={nearbyCameras} riskZones={infrastructure.zones} panic={() => void requestEmergency()} emergencyMessage={emergencyMessage} emergencyRequested={emergencyRequest.current?.journeyId === s.journey.journey_id} stop={() => { if (s.busy) return; if (demoRef.current) exitDemo(false); void guardian.stop() }} resume={() => void guardian.resume()}/> : restoring ? <p className="notice" role="status">Restaurando sesión…</p> : account ? (user ? <section className="panel"><h1>{user.nombre_completo}</h1><p>{user.email}</p><button className="secondary" onClick={logout}>Cerrar sesión</button><button className="text-button" onClick={() => setAccount(false)}>Volver</button></section> : <AuthPage back={() => setAccount(false)} loggedIn={value => { setUser(value); setAuthError(''); setAccount(false) }}/>) : <HomePage state={s} user={user} origin={origin} destination={destination} routePlan={routePlan} planning={planning} planningError={planningError} canPlan={canPlan} canStart={canStart} onOriginChange={changeOrigin} onDestinationChange={changeDestination} onMapReady={setMapsReady} onPlacesReady={setPlacesReady} calculateRoute={() => void calculateRoute()} start={() => void start()} account={() => setAccount(true)} savedRoutes={savedRoutes} deleteEvidence={id => void deleteEvidence(id)}/>}
      {evidenceError && <p className="notice" role="alert">{evidenceError}</p>}
      {hasSnapshot && <section className="panel evidence-save"><h2>Guardar recorrido 24 h</h2><p>Evidencia temporal local. Incluye la traza disponible en esta sesión y distingue puntos reales y DEMO.</p><label htmlFor="incident-note">Nota opcional</label><textarea id="incident-note" maxLength={1000} value={incidentNote} onChange={event => setIncidentNote(event.target.value)}/><button className="secondary full" disabled={savingEvidence || savedJourney.current === snapshot.current?.journey_id} onClick={() => void saveEvidence()}>{savingEvidence ? 'Guardando…' : 'Guardar recorrido 24 h'}</button><p role="status">{evidenceMessage}</p></section>}
      <InstallPrompt active={!!s.journey}/>
      <footer>GUARDIAN CORE <span>Tu seguridad, en movimiento.</span></footer>
    </main>
    {s.checkIn && !s.stopPending && <CheckInModal key={s.checkIn.command_id} demo={!!demo} answer={ok => void resolveCheckIn(s.checkIn!.command_id, ok ? 'ok' : 'help')} timeout={() => void resolveCheckIn(s.checkIn!.command_id, 'timeout')}/>}
  </div>
}

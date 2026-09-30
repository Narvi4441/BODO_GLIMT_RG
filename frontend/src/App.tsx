import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, accessToken, ACCESS_TOKEN_KEY } from './services/api'
import { useJourney } from './hooks/useJourney'
import { guardian } from './services/telemetry'
import { HomePage } from './pages/HomePage'
import { ActiveJourney } from './pages/ActiveJourney'
import { AuthPage } from './pages/AuthPage'
import { MonitorPage } from './pages/MonitorPage'
import { CheckInModal } from './components/CheckInModal'
import { InstallPrompt } from './components/InstallPrompt'
import cameraDataset from './data/camaras.json'
import { distanceMeters, pathLength, routeDeviation, scenarioInfrastructure, referenceZones, routePoint, offsetPoint, distanceAlongRoute, routeRemainder } from './services/demoScenario'
import { evidence24h } from './services/evidence24h'
import type { Coordinate, DemoState, Destination, EvidenceSnapshot, RoutePlan, SafetyCamera, SavedEvidence, TracePoint, User } from './types'

const DEMO_WALK_SPEED_MPS = 5.56

function validCoordinate(value: Coordinate | null | undefined): value is Coordinate {
  return !!value && Number.isFinite(value.lat) && Number.isFinite(value.lng)
    && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180
}

const datasetCameras = cameraDataset.flatMap<SafetyCamera>(camera => {
  const lat = Number(camera.lat)
  const lng = Number(camera.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return []
  return [{ id: camera.id, lat, lng, esquina: camera.esquina, colonia: camera.colonia, alcaldia: camera.alcaldia, poste: camera.poste, hasCamera: true, hasHelpButton: camera.boton === 'CON BOTON', hasSpeaker: camera.altavoz === 'CON ALTAVOZ' }]
})
function lightPreference() {
  try { return localStorage.getItem('guardian-theme') === 'light' } catch { return false }
}
export default function App() {
  const token = new URLSearchParams(window.location.search).get('monitor')
  return token !== null ? <MonitorPage key={token} token={token}/> : <GuardianApp/>
}

function GuardianApp() {
  const s = useJourney()
  const [networkNotice, setNetworkNotice] = useState('')
  const previousNetwork = useRef(s.network)
  const previousPending = useRef(s.pending)
  const awaitingSync = useRef(false)
  const [user, setUser] = useState<User | null>(null)
  const [account, setAccount] = useState(false)
  const loginDialog = useRef<HTMLDialogElement>(null)
  const startBusy = useRef(false)
  const stopBusy = useRef(false)
  const [error, setError] = useState('')
  const [light, setLight] = useState(lightPreference)
  const [restoring, setRestoring] = useState(() => !!accessToken())
  const [authError, setAuthError] = useState('')
  const [restoreAttempt, setRestoreAttempt] = useState(0)
  const [origin, setOrigin] = useState<Coordinate | null>(null)
  const [destination, setDestination] = useState<Destination | null>(null)
  const [routePlan, setRoutePlan] = useState<RoutePlan | null>(null)
  const [planning, setPlanning] = useState(false)
  const planningBusy = useRef(false)
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
  const demoPath = useRef<Coordinate[]>([])
  const demoVersion = useRef(0)
  const demoPlanning = useRef(false)
  const lastDemoTick = useRef(0)
  const demoPoint = useMemo(() => demo ? routePoint(demoPath.current, demo.distance)?.point ?? null : null, [demo])
  const currentPosition = useMemo(() => demo ? demoPoint : s.point ? { lat: s.point.latitude, lng: s.point.longitude } : null, [!!demo, demoPoint, s.point?.latitude, s.point?.longitude])
  const deviation = useMemo(() => currentPosition && routePlan ? routeDeviation(currentPosition, routePlan.path) : null, [currentPosition, routePlan])
  const infrastructure = useMemo(() => demo && routePlan ? scenarioInfrastructure(routePlan.path) : { cameras: [], zones: [] }, [!!demo, routePlan])
  const cameraCandidates = useRef<{ position: Coordinate; cameras: SafetyCamera[] } | null>(null)
  const nearbyCameras = useMemo(() => {
    if (!currentPosition) return []
    if (!cameraCandidates.current || distanceMeters(cameraCandidates.current.position, currentPosition) >= 20) {
      cameraCandidates.current = { position: currentPosition, cameras: datasetCameras.filter(camera => distanceMeters(currentPosition, camera) <= 1020) }
    }
    // Margen de candidatos + filtro exacto sobre posición ACTUAL, incluso cerca del límite.
    return cameraCandidates.current.cameras.map(camera => ({ ...camera, distance_m: distanceMeters(currentPosition, camera) })).filter(camera => camera.distance_m <= 1000)
  }, [currentPosition])
  const zoneIds = referenceZones.filter(zone => currentPosition && distanceMeters(currentPosition, zone.center) <= zone.radius_m + 2000).map(zone => zone.zone_id).join(',')
  const nearbyZones = useMemo(() => [...referenceZones.filter(zone => zoneIds.split(',').includes(zone.zone_id)), ...infrastructure.zones], [zoneIds, infrastructure])
  const insideZones = useRef(new Set<string>())
  const [zoneNotice, setZoneNotice] = useState('')
  useEffect(() => {
    if (!s.journey || s.stopPending) { insideZones.current.clear(); setZoneNotice(''); return }
    if (!currentPosition || (demo && !demo.gpsAvailable)) return
    const inside = referenceZones.filter(zone => distanceMeters(currentPosition, zone.center) <= zone.radius_m)
    const entered = inside.filter(zone => !insideZones.current.has(zone.zone_id))
    insideZones.current = new Set(inside.map(zone => zone.zone_id))
    if (entered.length) setZoneNotice(entered.map(zone => `Atención: ingresaste a una zona de referencia de nivel ${zone.level}. ${zone.name}.`).join(' '))
    else if (!inside.length) setZoneNotice('')
  }, [currentPosition, s.journey?.journey_id, s.stopPending, demo?.gpsAvailable])
  useEffect(() => {
    if (!networkNotice) return
    const timer = setTimeout(() => setNetworkNotice(''), 6000)
    return () => clearTimeout(timer)
  }, [networkNotice])

  useEffect(() => {
    const previous = previousNetwork.current
    previousNetwork.current = s.network
    if (previous === 'ONLINE' && s.network === 'OFFLINE') setNetworkNotice('Sin conexión. Guardando datos localmente.')
    else if (previous === 'OFFLINE' && s.network !== 'OFFLINE') {
      setNetworkNotice('Conexión restaurada. Sincronizando datos.')
      awaitingSync.current = s.pending > 0
    }
  }, [s.network, s.pending])
  useEffect(() => {
    const previous = previousPending.current
    previousPending.current = s.pending
    if (awaitingSync.current && previous > 0 && s.pending === 0) {
      awaitingSync.current = false
      setNetworkNotice('Sincronización terminada.')
    }
  }, [s.pending])
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
    if (!currentPosition || (demo && !demo.gpsAvailable) || (!demo && s.point?.journey_id !== journey.journey_id)) return
    const source = demo ? 'DEMO' : 'REAL'
    const last = value.actual_trace.at(-1)
    if (!last || last.source !== source || distanceMeters(last, currentPosition) >= 3) {
      const point: TracePoint = { ...currentPosition, source, timestamp: demo ? new Date().toISOString() : s.point!.timestamp }
      value.actual_trace = [...value.actual_trace, point]
      setActualTrace(value.actual_trace)
      if (deviation !== null && deviation > 40) value.deviation_events = [...value.deviation_events, { ...point, distance_m: deviation }]
    }
  }, [s.journey, s.stopPending, s.risk, s.point, currentPosition?.lat, currentPosition?.lng, !!demo, routePlan, deviation])

  function activateDemo() {
    if (!routePlan?.path.length || s.busy || s.stopPending || !s.acquiring) return

    if (
      !window.confirm(
        'El modo demo sustituirá temporalmente la posición GPS enviada durante la demostración.'
      )
    ) return

    guardian.setDemoMode(true)

    const startPosition = currentPosition ?? routePlan.path[0]
    const along = distanceAlongRoute(startPosition, routePlan.path)
    const remainingPath = routeRemainder(routePlan.path, along)

    demoPath.current =
      remainingPath.length >= 2
        ? remainingPath
        : routePlan.path

    const value: DemoState = {
      distance: 0,
      moving: false,
      gpsAvailable: true,
      offset: 0,
      planning: false,
      routeError: '',
    }

    demoRef.current = value
    setDemo(value)

    lastDemoTick.current = Date.now()
    lastDemoSend.current = 0
  }

  function changeDemo(patch: Partial<DemoState>) {
    if (!demoRef.current) return

    if (patch.offset !== undefined) {
      void planDemo(patch.offset)
      return
    }

    const value = {
      ...demoRef.current,
      ...patch,
    }

    demoRef.current = value
    setDemo(value)
  }

  function exitDemo(resume = true) {
    demoVersion.current++
    demoPlanning.current = false
    demoRef.current = null
    setDemo(null)
    demoPath.current = []
    lastDemoTick.current = 0

    guardian.setDemoMode(false)

    if (resume) {
      void guardian.resume()
    }
  }

  async function planDemo(offset: 0 | 150 | 350) {
    const value = demoRef.current

    if (
      !value ||
      !routePlan ||
      demoPlanning.current ||
      !value.gpsAvailable
    ) return

    const position =
      routePoint(demoPath.current, value.distance)?.point

    if (!position) return

    const version = ++demoVersion.current

    demoPlanning.current = true

    changeDemo({
      moving: false,
      planning: true,
      routeError: '',
    })

    try {
      let nextPath: Coordinate[] | null = null

      const along =
        distanceAlongRoute(position, routePlan.path)

      const validate = (path: Coordinate[]) =>
        path.length >= 2 &&
        path.every(validCoordinate) &&
        distanceMeters(position, path[0]) <= 15

      /*
       * REGRESAR A RUTA
       */
      if (offset === 0) {
        const rejoin = Math.min(
          pathLength(routePlan.path),
          along + 60
        )

        const target =
          routePoint(routePlan.path, rejoin)?.point

        if (target) {
          const result = await api.planRoute(
            position,
            target
          )

          if (
            validate(result.path) &&
            distanceMeters(
              result.path.at(-1)!,
              target
            ) <= 15
          ) {
            nextPath = [
              position,
              ...result.path,
              ...routeRemainder(
                routePlan.path,
                rejoin
              ),
            ]
          }
        }
      }

      /*
       * DESVÍO MODERADO / SEVERO
       */
      else {
        const base =
          routePoint(routePlan.path, along)

        if (base) {
          for (const side of [-90, 90]) {
            const waypoint = offsetPoint(
              base.point,
              offset,
              base.bearing + side
            )

            try {
              const result =
                await api.planRoute(
                  position,
                  routePlan.destination,
                  waypoint
                )

              const separation = Math.max(
                ...result.path.map(
                  point =>
                    routeDeviation(
                      point,
                      routePlan.path
                    ) ?? 0
                )
              )

              const minimumSeparation =
                offset === 350 ? 301 : 110

              const maximumSeparation =
                offset * 1.6

              if (
                validate(result.path) &&
                separation >= minimumSeparation &&
                separation <= maximumSeparation
              ) {
                nextPath = [
                  position,
                  ...result.path,
                ]

                break
              }
            } catch {
              // Probar el lado perpendicular opuesto.
              // Nunca fabricar una trayectoria sintética.
            }

            if (
              version !== demoVersion.current
            ) return
          }
        }
      }

      if (
        version !== demoVersion.current ||
        !demoRef.current
      ) return

      if (!nextPath) {
        throw new Error(
          'No se encontró un recorrido peatonal válido.'
        )
      }

      /*
       * SOLO reemplazamos el path si Google encontró
       * una ruta peatonal válida.
       */
      demoPath.current = nextPath

      const next: DemoState = {
        ...demoRef.current,
        distance: 0,
        offset,
        planning: false,
        routeError: '',
        moving: demoRef.current.gpsAvailable,
      }

      demoRef.current = next
      setDemo(next)

      lastDemoTick.current = Date.now()
    } catch {
      /*
       * IMPORTANTE:
       * Si falla el desvío/reincorporación,
       * NO borrar demoPath.current.
       * Se conserva la ruta que ya estaba funcionando.
       */
      if (
        version === demoVersion.current &&
        demoRef.current
      ) {
        changeDemo({
          planning: false,
          moving: value.moving,
          routeError:
            'No se encontró una ruta peatonal alternativa. Puedes continuar por la ruta actual.',
        })
      }
    } finally {
      if (version === demoVersion.current) {
        demoPlanning.current = false
      }
    }
  }
  useEffect(() => {
    if (!demo || !routePlan || !s.journey || s.stopPending) return
    const timer = setInterval(() => {
      const now = Date.now()
      const elapsedSeconds = lastDemoTick.current ? Math.min(1.5, (now - lastDemoTick.current) / 1000) : 0
      lastDemoTick.current = now
      const value = demoRef.current
      const state = guardian.snapshot()
      if (!value || !value.gpsAvailable || state.stopPending || !state.journey || elapsedSeconds <= 0) return
      const path = demoPath.current, total = pathLength(path)
      const advance = value.moving && !value.planning ? DEMO_WALK_SPEED_MPS * elapsedSeconds : 0
      const next = { ...value, distance: Math.min(total, value.distance + advance) }
      if (next.distance >= total) next.moving = false
      demoRef.current = next
      if (next.distance !== value.distance || next.moving !== value.moving) setDemo(next)
      const position = routePoint(path, next.distance)?.point
      if (position && Date.now() - lastDemoSend.current >= state.interval * 1000) {
        lastDemoSend.current = Date.now()
        const speed = advance > 0 ? DEMO_WALK_SPEED_MPS : 0
        void guardian.submitDemoPosition(position, speed).catch(() => setError('No se pudo adquirir el punto demo.'))
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [!!demo, routePlan, s.journey?.journey_id, s.stopPending])
  useEffect(() => {
    if ((!s.journey || s.stopPending) && demoRef.current) exitDemo(false)
  }, [s.journey, s.stopPending])
  useEffect(() => () => {
    demoVersion.current++
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
    if (emergencyRequest.current?.journeyId === journey.journey_id) return
    emergencyRequest.current = { journeyId: journey.journey_id, commandId: null }
    setEmergencyMessage('Solicitando modo de emergencia...')
    try {
      const command = state.emergency || state.risk?.status === 'CRITICAL' ? null : await api.sendCommand(journey.journey_id, journey.user_id)
      if (emergencyRequest.current?.journeyId !== journey.journey_id) return
      emergencyRequest.current.commandId = command?.command_id ?? null
      setEmergencyMessage('Ayuda solicitada. Enviando aviso a tu persona de confianza…')
      try {
        const delivery = await api.sendPanicTelegram(journey.journey_id, command?.command_id)
        if (guardian.snapshot().journey?.journey_id !== journey.journey_id || guardian.snapshot().stopPending) return
        setEmergencyMessage(delivery.sent ? 'Emergencia activada. Alerta enviada por Telegram.' : 'Emergencia activada. El aviso ya fue solicitado; no se enviará por duplicado.')
      } catch {
        if (guardian.snapshot().journey?.journey_id === journey.journey_id) setEmergencyMessage('Emergencia solicitada. No se pudo confirmar el aviso por Telegram. Puedes llamar al 911.')
      }
    } catch (error) {
      // Un timeout HTTP no prueba que el servidor no haya creado la orden: no repetirla.
      if (error instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(error.status)) {
        emergencyRequest.current = null
        setEmergencyMessage('No se pudo solicitar ayuda. Revisa tu sesión y conexión e intenta de nuevo.')
      } else setEmergencyMessage('No se pudo confirmar la solicitud. No se repite automáticamente para evitar duplicados. Puedes llamar al 911.')
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
  useEffect(() => {
    if (previousJourney.current && !s.journey) clearPlanning()
    previousJourney.current = s.journey?.journey_id
  }, [s.journey, clearPlanning])
  useEffect(() => () => { planVersion.current++ }, [])
  const canPlan = validCoordinate(origin) && validCoordinate(destination)
    && mapsReady && placesReady && !planning && !s.busy && s.network !== 'OFFLINE'
  const canStart = canPlan && !!routePlan && routePlan.path.length > 0
    && routePlan.origin.lat === origin?.lat && routePlan.origin.lng === origin?.lng
    && routePlan.destination.lat === destination?.lat && routePlan.destination.lng === destination?.lng
    && s.ready && window.isSecureContext && !s.storageError
  async function calculateRoute() {
    if (!canPlan || !origin || !destination || planningBusy.current) return
    planningBusy.current = true
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
      setPlanningError('No fue posible calcular la ruta. Comprueba tu conexión e intenta de nuevo.')
    } finally {
      if (version === planVersion.current) setPlanning(false)
      planningBusy.current = false
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
    if (!user) { loginDialog.current?.showModal(); return }
    if (!canStart || startBusy.current) return
    startBusy.current = true
    try { setError(''); await guardian.start(String(user.id_usuario)) }
    catch { setError('No pudimos iniciar el recorrido. Intenta de nuevo.') }
    finally { startBusy.current = false }
  }
  async function stop() {
    if (s.busy || s.stopPending || stopBusy.current || !window.confirm('¿Finalizar acompañamiento?')) return
    stopBusy.current = true
    if (demoRef.current) exitDemo(false)
    try { await guardian.stop() }
    finally { stopBusy.current = false }
  }
  return <div className={`app-shell ${light ? 'light' : ''}`}>
    <header><a className="brand" href="/" aria-label="GUARDIAN Core inicio" onClick={event => { event.preventDefault(); setAccount(false) }}><img src="/icon.svg" alt=""/> <span>GUARDIAN <small>CORE</small></span></a>{!user && !s.journey && <button className="primary login-visible" onClick={() => setAccount(true)}>Iniciar sesión</button>}<button className="theme" aria-label="Cambiar tema" onClick={() => { setLight(!light); localStorage.setItem('guardian-theme', light ? 'dark' : 'light') }}>{light ? '☾' : '☀'}</button></header>
    <main><div className="system-line"><span className={`network ${s.network}`}><i/>{s.network === 'OFFLINE' ? 'Sin conexión · OFFLINE' : s.network}</span><span>{s.acquiring ? 'TRAYECTO ACTIVO' : 'TELEMETRÍA URBANA'}</span></div>
      {demo && <div className="demo-banner" role="status">MODO DEMO — SIMULACIÓN DE TELEMETRÍA</div>}
      {!window.isSecureContext && <p className="notice" role="alert">Para usar GPS e instalar la PWA desde tu teléfono, abre esta página con HTTPS confiable.</p>}
      {(s.error || error) && <p className="notice" role="alert">{error || (s.network === 'OFFLINE' ? 'Sin conexión. Guardaremos los datos temporalmente.' : s.journey ? 'No se pudo actualizar el recorrido. Tus datos pendientes se conservan.' : 'No pudimos iniciar el recorrido. Comprueba tu conexión y ubicación.')}</p>}
      {s.gpsError && <p className="notice" role="alert">{s.gpsError}</p>}
      {s.storageError && <p className="notice" role="alert">No se pudieron guardar los datos en este dispositivo. Conserva abierta la aplicación y revisa el almacenamiento del navegador.</p>}
      {networkNotice && <p className="notice" role="status">{networkNotice}</p>}
      {zoneNotice && <p className="notice" role="status">{demo ? 'SIMULACIÓN · ' : ''}{zoneNotice} <button className="text-button" onClick={() => setZoneNotice('')}>Cerrar</button></p>}
      {authError && <p className="notice" role="alert">{authError} <button className="text-button" disabled={restoring} onClick={() => setRestoreAttempt(value => value + 1)}>Reintentar sesión</button></p>}
      {s.pending > 0 && <details className="buffer panel"><summary>Datos pendientes de sincronización</summary><div><strong>{s.pending} pendientes</strong><p>Puntos GPS y confirmaciones guardados localmente.</p><button className="text-button" onClick={() => void guardian.sync()}>Reintentar</button><button className="text-button" onClick={() => void guardian.downloadPending().catch(() => setError('No se pudo exportar el buffer.'))}>Descargar</button></div></details>}

      {s.journey ? <ActiveJourney state={s} routePlan={routePlan} actualTrace={actualTrace} currentPosition={currentPosition} deviation={deviation} demo={demo} activateDemo={activateDemo} changeDemo={changeDemo} exitDemo={() => exitDemo()} safetyCameras={nearbyCameras} riskZones={nearbyZones} panic={() => void requestEmergency()} emergencyMessage={emergencyMessage} emergencyRequested={emergencyRequest.current?.journeyId === s.journey.journey_id} stop={() => void stop()} resume={() => void guardian.resume()}/> : restoring ? <p className="notice" role="status">Restaurando sesión…</p> : account ? (user ? <section className="panel"><h1>{user.nombre_completo}</h1><p>{user.email}</p><button className="secondary" onClick={logout}>Cerrar sesión</button><button className="text-button" onClick={() => setAccount(false)}>Volver</button></section> : <AuthPage back={() => setAccount(false)} loggedIn={value => { setUser(value); setAuthError(''); setAccount(false) }}/>) : <HomePage state={s} user={user} origin={origin} destination={destination} routePlan={routePlan} planning={planning} planningError={planningError} canPlan={canPlan} canStart={canStart} onOriginChange={changeOrigin} onDestinationChange={changeDestination} onMapReady={setMapsReady} onPlacesReady={setPlacesReady} calculateRoute={() => void calculateRoute()} start={() => void start()} account={() => setAccount(true)} savedRoutes={savedRoutes} deleteEvidence={id => void deleteEvidence(id)}/>}
      {evidenceError && <p className="notice" role="alert">{evidenceError}</p>}
      {hasSnapshot && <section className="panel evidence-save"><h2>Guardar recorrido 24 h</h2><p>Evidencia temporal local. Incluye la traza disponible en esta sesión y distingue puntos reales y DEMO.</p><label htmlFor="incident-note">Nota opcional</label><textarea id="incident-note" maxLength={1000} value={incidentNote} onChange={event => setIncidentNote(event.target.value)}/><button className="secondary full" disabled={savingEvidence || savedJourney.current === snapshot.current?.journey_id} onClick={() => void saveEvidence()}>{savingEvidence ? 'Guardando…' : 'Guardar recorrido 24 h'}</button><p role="status">{evidenceMessage}</p></section>}
      <InstallPrompt active={!!s.journey}/>
      <footer>GUARDIAN CORE <span>Tu seguridad, en movimiento.</span></footer>
    </main>
    {s.checkIn && !s.stopPending && <CheckInModal key={s.checkIn.command_id} demo={!!demo} answer={ok => void resolveCheckIn(s.checkIn!.command_id, ok ? 'ok' : 'help')} timeout={() => void resolveCheckIn(s.checkIn!.command_id, 'timeout')}/>}
    <dialog ref={loginDialog} aria-labelledby="login-required-title"><h2 id="login-required-title">Inicia sesión</h2><p>Para iniciar un acompañamiento necesitas iniciar sesión.</p><button className="primary full" onClick={() => { loginDialog.current?.close(); setAccount(true) }}>Iniciar sesión</button><button className="secondary full" onClick={() => loginDialog.current?.close()}>Cancelar</button></dialog>
  </div>
}

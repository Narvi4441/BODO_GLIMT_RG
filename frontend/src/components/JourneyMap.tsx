import { useEffect, useRef, useState } from 'react'
import type { Coordinate, RiskZone, SafetyCamera } from '../types'
import { routeDeviation } from '../services/demoScenario'
import { loadGoogleMaps, onGoogleMapsFailure, type GoogleMapsApi, type MapInstance, type MapsLibrary, type OverlayInstance, type PolylineInstance } from '../services/googleMaps'

interface Props {
  currentPosition?: Coordinate | null
  origin?: Coordinate | null
  destination?: Coordinate | null
  path?: Coordinate[]
  plannedPath?: Coordinate[]
  referencePath?: Coordinate[]
  actualTrace?: Coordinate[]
  safetyCameras?: SafetyCamera[]
  riskZones?: RiskZone[]
  onReady?: (ready: boolean) => void
}
interface PositionMarker extends OverlayInstance { update(position: Coordinate | null | undefined): void; detail(value: string): void }
interface MapSession {
  api: GoogleMapsApi
  map: MapInstance
  line: PolylineInstance
  trace: PolylineInstance
  library: MapsLibrary
  current: PositionMarker
  origin: PositionMarker
  destination: PositionMarker
}
const emptyPath: Coordinate[] = []
const emptyCameras: SafetyCamera[] = []
const emptyZones: RiskZone[] = []
// Superficie adicional del SDK, local a este renderizador; el loader no cambia.
interface CircleLibrary extends MapsLibrary {
  Circle: new (options: { map: MapInstance; center: Coordinate; radius: number; fillColor: string; fillOpacity: number; strokeColor: string; strokeWeight: number; clickable: boolean }) => { setMap(map: MapInstance | null): void }
}

function marker(api: GoogleMapsApi, library: MapsLibrary, map: MapInstance, kind: string, label: string, detail = label, click?: () => void): PositionMarker {
  class PositionOverlay extends library.OverlayView {
    private position: Coordinate | null = null
    private element = document.createElement('div')
    constructor() {
      super()
      this.element.className = `map-pin map-pin-${kind}`
      this.element.textContent = label
      this.element.title = detail
      if (kind === 'camera') {
        this.element.tabIndex = 0
        this.element.setAttribute('role', 'button')
        this.element.setAttribute('aria-label', detail)
        this.element.onclick = event => { event.stopPropagation(); click?.() }
        this.element.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); click?.() } }
      }
      this.element.style.position = 'absolute'
      this.element.style.transform = 'translate(-50%, -50%)'
      this.element.style.pointerEvents = kind === 'camera' ? 'auto' : 'none'
      this.setMap(map)
    }
    onAdd() { this.getPanes()?.overlayMouseTarget.appendChild(this.element) }
    onRemove() { this.element.remove() }
    update(position: Coordinate | null | undefined) { this.position = position ?? null; this.draw() }
    detail(value: string) { this.element.title = value; this.element.setAttribute('aria-label', value) }
    draw() {
      this.element.hidden = !this.position
      if (!this.position) return
      const pixel = this.getProjection()?.fromLatLngToDivPixel(new api.LatLng(this.position.lat, this.position.lng))
      if (!pixel) return
      this.element.style.left = `${pixel.x}px`
      this.element.style.top = `${pixel.y}px`
    }
  }
  return new PositionOverlay()
}

export function JourneyMap({ currentPosition, origin, destination, path: legacyPath, plannedPath, referencePath, actualTrace = emptyPath, safetyCameras = emptyCameras, riskZones = emptyZones, onReady }: Props) {
  const path = plannedPath ?? legacyPath ?? emptyPath
  const originalPath = referencePath ?? path
  const canvas = useRef<HTMLDivElement>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const [sdk, setSdk] = useState<{ api: GoogleMapsApi; library: MapsLibrary } | null>(null)
  const [session, setSession] = useState<MapSession | null>(null)
  const sessionRef = useRef<MapSession | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const initial = currentPosition ?? origin ?? destination ?? path[0]
  const failed = useRef(false)
  const listeners = useRef<{ remove(): void }[]>([])
  const tileTimeout = useRef<number | undefined>(undefined)
  const fittedPath = useRef('')
  const cameras = useRef(new Map<string, PositionMarker>())
  const traces = useRef<PolylineInstance[]>([])
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null)
  const [selectedZone, setSelectedZone] = useState<RiskZone | null>(null)
  const camera = safetyCameras.find(item => item.id === selectedCamera)

  useEffect(() => {
    let disposed = false
    const fail = () => {
      if (disposed) return
      failed.current = true
      setReady(false)
      setError('No fue posible cargar Google Maps.')
      onReadyRef.current?.(false)
    }
    onReadyRef.current?.(false)
    const unsubscribe = onGoogleMapsFailure(fail)
    const loadingTimeout = window.setTimeout(fail, 15000)
    void loadGoogleMaps().then(async api => ({ api, library: await api.importLibrary('maps') })).then(value => {
      window.clearTimeout(loadingTimeout)
      if (!disposed && !failed.current) setSdk(value)
    }).catch(fail)
    return () => {
      disposed = true
      window.clearTimeout(loadingTimeout)
      window.clearTimeout(tileTimeout.current)
      unsubscribe()
      listeners.current.forEach(listener => listener.remove())
      const active = sessionRef.current
      if (active) {
        active.line.setMap(null)
        active.trace.setMap(null)
        active.current.setMap(null)
        active.origin.setMap(null)
        active.destination.setMap(null)
        active.api.event.clearInstanceListeners(active.map)
      }
      cameras.current.forEach(pin => pin.setMap(null))
      cameras.current.clear()
      traces.current.forEach(line => line.setMap(null))
      traces.current = []
      sessionRef.current = null
      onReadyRef.current?.(false)
    }
  }, [])

  useEffect(() => {
    if (!sdk || !canvas.current || !initial || sessionRef.current || failed.current) return
    try {
      const { api, library } = sdk
      const options = {
        center: initial, zoom: 16, mapTypeControl: false, streetViewControl: false,
        fullscreenControl: false, clickableIcons: false, gestureHandling: 'greedy',
        zoomControl: true, scrollwheel: true,
      }
      const map = new library.Map(canvas.current, options)
      const active: MapSession = {
        api, map, library,
        line: new library.Polyline({ map, path: [], strokeColor: '#4285f4', strokeOpacity: 1, strokeWeight: 6, clickable: false }),
        trace: new library.Polyline({ map, path: [], strokeColor: '#12bfa3', strokeOpacity: 1, strokeWeight: 4, clickable: false }),
        current: marker(api, library, map, 'current', '●'),
        origin: marker(api, library, map, 'origin', 'O'),
        destination: marker(api, library, map, 'destination', 'D'),
      }
      sessionRef.current = active
      setSession(active)
      tileTimeout.current = window.setTimeout(() => {
        failed.current = true
        setError('No fue posible cargar Google Maps.')
        onReadyRef.current?.(false)
      }, 15000)
      listeners.current.push(api.event.addListenerOnce(map, 'tilesloaded', () => {
        if (failed.current) return
        window.clearTimeout(tileTimeout.current)
        setReady(true)
        onReadyRef.current?.(true)
      }))
    } catch {
      failed.current = true
      setError('No fue posible cargar Google Maps.')
      onReadyRef.current?.(false)
    }
  }, [sdk, initial?.lat, initial?.lng])

  useEffect(() => {
    if (!session) return
    session.line.setPath(path)
    session.origin.update(origin)
    session.destination.update(destination)
    const geometry = JSON.stringify(path)
    if (path.length && geometry !== fittedPath.current) {
      fittedPath.current = geometry
      const bounds = new session.api.LatLngBounds()
      path.forEach(point => bounds.extend(point))
      if (origin) bounds.extend(origin)
      if (destination) bounds.extend(destination)
      session.map.fitBounds(bounds, 52)
    }
  }, [session, path, origin?.lat, origin?.lng, destination?.lat, destination?.lng])

  useEffect(() => {
    if (!session) return
    // Polylines persistentes por tramo; ámbar solo si se separa >40 m de la ruta original.
    const segments: { outside: boolean; points: Coordinate[] }[] = []
    for (let i = 1; i < actualTrace.length; i++) {
      const outside = (routeDeviation(actualTrace[i], originalPath) ?? 0) > 40
      const last = segments.at(-1)
      if (last && last.outside === outside) last.points.push(actualTrace[i])
      else segments.push({ outside, points: [actualTrace[i - 1], actualTrace[i]] })
    }
    segments.forEach((segment, index) => {
      // El índice conserva alternancia de colores salvo que cambie la ruta.
      const line = traces.current[index] as (PolylineInstance & { setOptions(options: { strokeColor: string }): void }) | undefined
      if (line) { line.setPath(segment.points); line.setOptions({ strokeColor: segment.outside ? '#ffae42' : '#12bfa3' }) }
      else traces.current[index] = new session.library.Polyline({ map: session.map, path: segment.points, strokeColor: segment.outside ? '#ffae42' : '#12bfa3', strokeOpacity: 1, strokeWeight: 4, clickable: false })
    })
    traces.current.splice(segments.length).forEach(line => line.setMap(null))
  }, [session, actualTrace, originalPath])

  useEffect(() => {
    if (!session) return
    const ids = new Set(safetyCameras.map(camera => camera.id))
    cameras.current.forEach((pin, id) => { if (!ids.has(id)) { pin.setMap(null); cameras.current.delete(id) } })
    safetyCameras.forEach(camera => {
      const detail = `${camera.id} · ${Math.round(camera.distance_m ?? 0)} m · Cámara del dataset`
      let pin = cameras.current.get(camera.id)
      if (!pin) {
        pin = marker(session.api, session.library, session.map, 'camera', 'C', detail, () => { setSelectedCamera(camera.id); setSelectedZone(null) })
        cameras.current.set(camera.id, pin)
      }
      pin.detail(detail)
      pin.update(camera)
    })
  }, [session, safetyCameras])

  useEffect(() => {
    if (!session) return
    const library = session.library as CircleLibrary
    const circles = riskZones.map(zone => {
      const circle = new library.Circle({
      map: session.map, center: zone.center, radius: zone.radius_m,
      fillColor: zone.severity === 'RED' ? '#ef445a' : '#f5c64e', fillOpacity: .2,
      strokeColor: zone.severity === 'RED' ? '#ef445a' : '#f5c64e', strokeWeight: 1, clickable: true,
      })
      const clickable = circle as typeof circle & { addListener(event: string, listener: () => void): { remove(): void } }
      const listener = clickable.addListener('click', () => { setSelectedZone(zone); setSelectedCamera(null) })
      return { circle, listener }
    })
    return () => circles.forEach(({ circle, listener }) => { listener.remove(); circle.setMap(null) })
  }, [session, riskZones])

  useEffect(() => {
    if (!session) return
    session.current.update(currentPosition)
  }, [session, currentPosition?.lat, currentPosition?.lng])

  return <div className="journey-map" aria-label="Mapa del recorrido">
    <div className="journey-map-viewport">
    <div className="journey-map-canvas" ref={canvas} />
    {(!ready || error) && <div className="map-placeholder" role={error ? 'alert' : 'status'}>
      <span className="map-placeholder-icon" aria-hidden="true">⌖</span>
      <strong>{error || (initial ? 'Cargando Google Maps…' : 'Tu recorrido empieza aquí')}</strong>
      {!error && !initial && <p>Obtén tu ubicación para ver el mapa.</p>}
    </div>}
      {ready && !error && currentPosition && <button type="button" className="map-recenter" aria-label="Centrar en mi ubicación" onClick={() => {
        session?.map.panTo(currentPosition)
        session?.map.setZoom(16)
      }}>⌖ Recentrar</button>}
      {(camera || (selectedZone && riskZones.some(zone => zone.zone_id === selectedZone.zone_id))) && <aside className="map-popup" aria-live="polite">
        <button className="text-button" aria-label="Cerrar información" onClick={() => { setSelectedCamera(null); setSelectedZone(null) }}>Cerrar ×</button>
        {camera ? <><strong>{camera.id}</strong><p>Cámara del dataset · {Math.round(camera.distance_m ?? 0)} m</p><p>{camera.esquina}<br/>{camera.colonia}<br/>{camera.alcaldia}</p><p>Botón de auxilio: {camera.hasHelpButton ? 'Sí' : 'No'}<br/>Altavoz: {camera.hasSpeaker ? 'Sí' : 'No'}</p></>
          : selectedZone && <><strong>{selectedZone.name || selectedZone.zone_id}</strong><p>{selectedZone.reference ? 'Zonas de referencia del prototipo' : 'Zona DEMO'}</p><p>Nivel: {selectedZone.level || selectedZone.severity} · Radio: {selectedZone.radius_m} m</p></>}
      </aside>}
    </div>
    {ready && !error && <>
      <div className="map-legend">
        {path.length > 0 && <span><i className="map-dot"/>Ruta planeada</span>}
        {actualTrace.length > 0 && <><span><i className="map-dot trace"/>Trayectoria real/demo</span><span><i className="map-dot deviation"/>Desviación &gt;40 m</span></>}
        {safetyCameras.length > 0 && <span>Cámara del dataset</span>}
        {riskZones.some(zone => zone.reference) && <span>Zonas de referencia del prototipo</span>}
        {riskZones.some(zone => !zone.reference) && <span>Zonas DEMO</span>}
        {currentPosition && <span><i className="map-dot current" />Tu ubicación</span>}
        {origin && path.length > 0 && <span><i className="map-dot origin" />Origen</span>}
        {destination && <span><i className="map-dot destination" />Destino</span>}
      </div>
    </>}
  </div>
}

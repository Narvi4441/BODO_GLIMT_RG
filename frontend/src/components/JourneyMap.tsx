import { useEffect, useRef, useState } from 'react'
import type { Coordinate } from '../types'
import { loadGoogleMaps, onGoogleMapsFailure, type GoogleMapsApi, type MapInstance, type MapsLibrary, type OverlayInstance, type PolylineInstance } from '../services/googleMaps'

interface Props {
  currentPosition?: Coordinate | null
  origin?: Coordinate | null
  destination?: Coordinate | null
  path?: Coordinate[]
  onReady?: (ready: boolean) => void
}
interface PositionMarker extends OverlayInstance { update(position: Coordinate | null | undefined): void }
interface MapSession {
  api: GoogleMapsApi
  map: MapInstance
  line: PolylineInstance
  current: PositionMarker
  origin: PositionMarker
  destination: PositionMarker
}
const emptyPath: Coordinate[] = []

function marker(api: GoogleMapsApi, library: MapsLibrary, map: MapInstance, kind: string, label: string): PositionMarker {
  class PositionOverlay extends library.OverlayView {
    private position: Coordinate | null = null
    private element = document.createElement('div')
    constructor() {
      super()
      this.element.className = `map-pin map-pin-${kind}`
      this.element.textContent = label
      this.element.style.position = 'absolute'
      this.element.style.transform = 'translate(-50%, -50%)'
      this.element.style.pointerEvents = 'none'
      this.setMap(map)
    }
    onAdd() { this.getPanes()?.overlayMouseTarget.appendChild(this.element) }
    onRemove() { this.element.remove() }
    update(position: Coordinate | null | undefined) { this.position = position ?? null; this.draw() }
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

export function JourneyMap({ currentPosition, origin, destination, path = emptyPath, onReady }: Props) {
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
        active.current.setMap(null)
        active.origin.setMap(null)
        active.destination.setMap(null)
        active.api.event.clearInstanceListeners(active.map)
      }
      sessionRef.current = null
      onReadyRef.current?.(false)
    }
  }, [])

  useEffect(() => {
    if (!sdk || !canvas.current || !initial || sessionRef.current || failed.current) return
    try {
      const { api, library } = sdk
      const map = new library.Map(canvas.current, {
        center: initial, zoom: 16, mapTypeControl: false, streetViewControl: false,
        fullscreenControl: false, clickableIcons: false, gestureHandling: 'cooperative',
      })
      const active: MapSession = {
        api, map,
        line: new library.Polyline({ map, path: [], strokeColor: '#12bfa3', strokeOpacity: 1, strokeWeight: 6, clickable: false }),
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
    if (path.length) {
      const bounds = new session.api.LatLngBounds()
      path.forEach(point => bounds.extend(point))
      if (origin) bounds.extend(origin)
      if (destination) bounds.extend(destination)
      session.map.fitBounds(bounds, 52)
    } else if (origin && destination) {
      session.map.fitBounds(new session.api.LatLngBounds().extend(origin).extend(destination), 52)
    }
  }, [session, path, origin?.lat, origin?.lng, destination?.lat, destination?.lng])

  useEffect(() => {
    if (!session) return
    session.current.update(currentPosition)
    if (currentPosition && !path.length && !destination) session.map.panTo(currentPosition)
  }, [session, currentPosition?.lat, currentPosition?.lng, path.length, destination])

  return <div className="journey-map" aria-label="Mapa del recorrido">
    <div className="journey-map-canvas" ref={canvas} />
    {(!ready || error) && <div className="map-placeholder" role={error ? 'alert' : 'status'}>
      <span className="map-placeholder-icon" aria-hidden="true">⌖</span>
      <strong>{error || (initial ? 'Cargando Google Maps…' : 'Tu recorrido empieza aquí')}</strong>
      {!error && !initial && <p>Obtén tu ubicación para ver el mapa.</p>}
    </div>}
    {ready && !error && <>
      {currentPosition && <button type="button" className="map-recenter" aria-label="Centrar en mi ubicación" onClick={() => {
        session?.map.panTo(currentPosition)
        session?.map.setZoom(16)
      }}>⌖</button>}
      <div className="map-legend">
        {currentPosition && <span><i className="map-dot current" />Tu ubicación</span>}
        {origin && path.length > 0 && <span><i className="map-dot origin" />Origen</span>}
        {destination && <span><i className="map-dot destination" />Destino</span>}
      </div>
    </>}
  </div>
}

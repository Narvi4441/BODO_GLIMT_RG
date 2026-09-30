import type { Coordinate } from '../types'

// Only the SDK surface used by the two presentation components is described here.
export interface MapInstance {
  panTo(position: Coordinate): void
  fitBounds(bounds: BoundsInstance, padding?: number): void
  setZoom(zoom: number): void
}
interface BoundsInstance { extend(position: Coordinate): BoundsInstance }
interface MapProjection { fromLatLngToDivPixel(position: unknown): { x: number; y: number } | null }
export interface OverlayInstance {
  setMap(map: MapInstance | null): void
  getPanes(): { overlayMouseTarget: HTMLElement } | null
  getProjection(): MapProjection | undefined
  onAdd(): void
  onRemove(): void
  draw(): void
}
export interface PolylineInstance {
  setMap(map: MapInstance | null): void
  setPath(path: Coordinate[]): void
}
export interface MapsLibrary {
  Map: new (element: HTMLElement, options: {
    center: Coordinate; zoom: number; mapTypeControl: boolean; streetViewControl: boolean;
    fullscreenControl: boolean; clickableIcons: boolean; gestureHandling: string;
  }) => MapInstance
  Polyline: new (options: {
    map: MapInstance; path: Coordinate[]; strokeColor: string;
    strokeOpacity: number; strokeWeight: number; clickable: boolean;
  }) => PolylineInstance
  OverlayView: new () => OverlayInstance
}
export interface PlaceSelectionEvent extends Event {
  placePrediction?: { toPlace(): {
    displayName?: string | null
    formattedAddress?: string | null
    location?: { lat(): number; lng(): number } | null
    fetchFields(options: { fields: string[] }): Promise<unknown>
  } }
}
export interface PlacesLibrary {
  PlaceAutocompleteElement: new () => HTMLElement & { placeholder: string }
}
export interface GoogleMapsApi {
  importLibrary(name: 'maps'): Promise<MapsLibrary>
  importLibrary(name: 'places'): Promise<PlacesLibrary>
  LatLng: new (lat: number, lng: number) => unknown
  LatLngBounds: new () => BoundsInstance
  event: {
    addListenerOnce(instance: object, event: string, listener: () => void): { remove(): void }
    clearInstanceListeners(instance: object): void
  }
}

type MapsWindow = Window & {
  google?: { maps?: GoogleMapsApi }
  __guardianMapsReady?: () => void
  gm_authFailure?: () => void
}
const mapsWindow = window as MapsWindow
const failureMessage = 'No fue posible cargar Google Maps.'
const failureListeners = new Set<() => void>()
let mapsPromise: Promise<GoogleMapsApi> | null = null
let authenticationFailed = false

export function onGoogleMapsFailure(listener: () => void): () => void {
  failureListeners.add(listener)
  if (authenticationFailed) listener()
  return () => { failureListeners.delete(listener) }
}

export function loadGoogleMaps(): Promise<GoogleMapsApi> {
  if (authenticationFailed) return Promise.reject(new Error(failureMessage))
  if (mapsPromise) return mapsPromise

  const previousAuthFailure = mapsWindow.gm_authFailure
  mapsWindow.gm_authFailure = () => {
    authenticationFailed = true
    failureListeners.forEach(listener => listener())
    previousAuthFailure?.()
  }

  if (mapsWindow.google?.maps?.importLibrary) {
    mapsPromise = Promise.resolve(mapsWindow.google.maps)
    return mapsPromise
  }
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()
  if (!key) {
    mapsPromise = Promise.reject(new Error('Google Maps no está configurado.'))
    return mapsPromise
  }

  mapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src^="https://maps.googleapis.com/maps/api/js"]')
    const script = existing ?? document.createElement('script')
    let settled = false
    const cleanUp = () => {
      window.clearTimeout(timeout)
      script.removeEventListener('load', ready)
      script.removeEventListener('error', fail)
      failureListeners.delete(fail)
    }
    const fail = () => {
      if (settled) return
      settled = true
      cleanUp()
      reject(new Error(failureMessage))
    }
    const ready = () => {
      if (settled) return
      const maps = mapsWindow.google?.maps
      if (!maps?.importLibrary || authenticationFailed) return
      settled = true
      cleanUp()
      resolve(maps)
    }
    const timeout = window.setTimeout(fail, 15000)
    failureListeners.add(fail)
    script.addEventListener('error', fail, { once: true })
    if (existing) {
      script.addEventListener('load', ready, { once: true })
      ready()
      return
    }
    mapsWindow.__guardianMapsReady = ready
    const query = new URLSearchParams({ key, v: 'weekly', loading: 'async', language: 'es', callback: '__guardianMapsReady' })
    script.src = `https://maps.googleapis.com/maps/api/js?${query}`
    script.async = true
    const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce
    if (nonce) script.nonce = nonce
    document.head.appendChild(script)
  })
  return mapsPromise
}

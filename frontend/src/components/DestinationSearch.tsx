import { useEffect, useRef, useState } from 'react'
import type { Destination } from '../types'
import { loadGoogleMaps, onGoogleMapsFailure, type PlaceSelectionEvent } from '../services/googleMaps'

interface Props {
  onChange: (destination: Destination | null) => void
  onReady?: (ready: boolean) => void
  disabled?: boolean
}

export function DestinationSearch({ onChange, onReady, disabled = false }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onChange, onReady, disabled })
  callbacks.current = { onChange, onReady, disabled }
  const selection = useRef(0)
  const [ready, setReady] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let disposed = false
    let loaded = false
    let mapsFailed = false
    let removeWidget = () => {}
    const fail = () => {
      if (disposed) return
      selection.current++
      setError('No fue posible cargar la búsqueda de destinos de Google Places.')
      setSelecting(false)
      callbacks.current.onChange(null)
      callbacks.current.onReady?.(false)
    }
    callbacks.current.onReady?.(false)
    const unsubscribe = onGoogleMapsFailure(() => { mapsFailed = true; fail() })
    const loadingTimeout = window.setTimeout(() => { if (!loaded) fail() }, 15000)
    void loadGoogleMaps().then(maps => maps.importLibrary('places')).then(({ PlaceAutocompleteElement }) => {
      if (disposed || mapsFailed || !host.current) return
      if (!PlaceAutocompleteElement) throw new Error('Places no disponible')
      const widget = new PlaceAutocompleteElement()
      widget.placeholder = '¿A dónde vas?'
      widget.setAttribute('aria-label', 'Buscar destino')
      const invalidate = () => {
        if (callbacks.current.disabled) return
        selection.current++
        setSelecting(false)
        setError('')
        callbacks.current.onChange(null)
      }
      const select = async (event: Event) => {
        if (callbacks.current.disabled) return
        const current = ++selection.current
        callbacks.current.onChange(null)
        setError('')
        setSelecting(true)
        try {
          const place = (event as PlaceSelectionEvent).placePrediction?.toPlace()
          if (!place) throw new Error('Selección inválida')
          await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] })
          if (disposed || current !== selection.current || callbacks.current.disabled) return
          const lat = place.location?.lat()
          const lng = place.location?.lng()
          if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            setError('El lugar seleccionado no tiene una ubicación válida.')
            return
          }
          callbacks.current.onChange({
            name: place.displayName || place.formattedAddress || 'Destino seleccionado',
            address: place.formattedAddress || '', lat, lng,
          })
          callbacks.current.onReady?.(true)
        } catch {
          if (!disposed && current === selection.current) setError('No fue posible obtener ese destino. Selecciona un lugar de la lista.')
        } finally {
          if (!disposed && current === selection.current) setSelecting(false)
        }
      }
      widget.addEventListener('input', invalidate, true)
      widget.addEventListener('gmp-select', select)
      widget.addEventListener('gmp-error', fail)
      host.current.replaceChildren(widget)
      loaded = true
      window.clearTimeout(loadingTimeout)
      setError('')
      setReady(true)
      callbacks.current.onReady?.(true)
      removeWidget = () => {
        widget.removeEventListener('input', invalidate, true)
        widget.removeEventListener('gmp-select', select)
        widget.removeEventListener('gmp-error', fail)
        widget.remove()
      }
    }).catch(fail)
    return () => {
      disposed = true
      window.clearTimeout(loadingTimeout)
      selection.current++
      unsubscribe()
      removeWidget()
      callbacks.current.onReady?.(false)
    }
  }, [])

  return <div className="destination-search">
    <span className="destination-search-label">¿A dónde vas?</span>
    <div className="places-input" ref={host} inert={disabled} aria-disabled={disabled} />
    {!ready && !error && <p className="places-status" role="status">Cargando búsqueda de destinos…</p>}
    {selecting && <p className="places-status" role="status">Obteniendo destino…</p>}
    {error && <p className="places-error" role="alert">{error}</p>}
  </div>
}

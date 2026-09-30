import type { Coordinate, RiskZone, SafetyCamera } from '../types'

const R = 6371000
const rad = Math.PI / 180
const deltaLng = (a: number, b: number) => ((a - b + 540) % 360) - 180
export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const y = (b.lat - a.lat) * rad, x = deltaLng(b.lng, a.lng) * rad
  const h = Math.sin(y / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(x / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)))
}

// Proyección local en metros centrada en la posición: distancia a cada segmento, no a sus vértices.
export function routeDeviation(position: Coordinate, path: Coordinate[]): number | null {
  if (!path.length) return null
  if (path.length === 1) return distanceMeters(position, path[0])
  const xy = (p: Coordinate) => ({ x: deltaLng(p.lng, position.lng) * rad * R * Math.cos(position.lat * rad), y: (p.lat - position.lat) * rad * R })
  let minimum = Infinity
  for (let i = 1; i < path.length; i++) {
    const a = xy(path[i - 1]), b = xy(path[i]), dx = b.x - a.x, dy = b.y - a.y
    const length2 = dx * dx + dy * dy
    const t = length2 ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / length2)) : 0
    minimum = Math.min(minimum, Math.hypot(a.x + t * dx, a.y + t * dy))
  }
  return minimum
}
export function deviationLabel(m: number): string {
  return m <= 40 ? 'En ruta' : m <= 100 ? 'Desviación leve' : m <= 300 ? 'Desviación moderada' : 'Desviación severa'
}
export function pathLength(path: Coordinate[]): number {
  return path.reduce((total, p, i) => total + (i ? distanceMeters(path[i - 1], p) : 0), 0)
}
export function routePoint(path: Coordinate[], distance: number): { point: Coordinate; bearing: number } | null {
  if (!path.length) return null
  let remaining = Math.max(0, distance)
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], length = distanceMeters(a, b)
    if (!length) continue
    if (remaining <= length || i === path.length - 1) {
      const fraction = Math.min(1, remaining / length)
      return {
        point: { lat: a.lat + (b.lat - a.lat) * fraction, lng: a.lng + deltaLng(b.lng, a.lng) * fraction },
        bearing: Math.atan2(deltaLng(b.lng, a.lng) * Math.cos(a.lat * rad), b.lat - a.lat) / rad,
      }
    }
    remaining -= length
  }
  return { point: path[path.length - 1], bearing: 0 }
}
export function offsetPoint(point: Coordinate, meters: number, bearing: number): Coordinate {
  const angle = meters / R, heading = bearing * rad, lat = point.lat * rad
  const nextLat = Math.asin(Math.sin(lat) * Math.cos(angle) + Math.cos(lat) * Math.sin(angle) * Math.cos(heading))
  const lng = point.lng + Math.atan2(Math.sin(heading) * Math.sin(angle) * Math.cos(lat), Math.cos(angle) - Math.sin(lat) * Math.sin(nextLat)) / rad
  return { lat: nextLat / rad, lng: ((lng + 540) % 360) - 180 }
}
export function demoPosition(path: Coordinate[], distance: number, offset: number): Coordinate | null {
  const base = routePoint(path, distance)
  if (!base || !offset) return base?.point ?? null
  // Si existe otro tramo cercano, buscar sobre la perpendicular hasta alcanzar la separación
  // deseada respecto de TODA la ruta. El payload siempre vuelve a medir la geometría resultante.
  let best = base.point, shortestOffset = Infinity
  for (const side of [-90, 90]) {
    let low = 0, high = offset
    const candidate = (meters: number) => offsetPoint(base.point, meters, base.bearing + side)
    while ((routeDeviation(candidate(high), path) ?? 0) < offset && high < 50000) high *= 2
    for (let i = 0; i < 24; i++) {
      const middle = (low + high) / 2
      if ((routeDeviation(candidate(middle), path) ?? 0) < offset) low = middle
      else high = middle
    }
    if (high < shortestOffset) { best = candidate(high); shortestOffset = high }
  }
  return best
}
export function scenarioInfrastructure(path: Coordinate[]): { cameras: SafetyCamera[]; zones: RiskZone[] } {
  if (!path.length) return { cameras: [], zones: [] }
  const length = pathLength(path)
  const incidents = [8, 12, 18, 27]
  const upperQuartile = [...incidents].sort((a, b) => a - b)[Math.ceil(incidents.length * .75) - 1]
  const zones: RiskZone[] = incidents.map((count, i) => ({
    zone_id: `ZONA-DEMO-${i + 1}`, center: routePoint(path, length * (i + 1) / 5)!.point,
    radius_m: 100 + i * 25, incident_count: count, severity: count > upperQuartile ? 'RED' : 'YELLOW',
  }))
  return { cameras: [], zones }
}

export const referenceZones: RiskZone[] = [
  { zone_id: 'gam', name: 'GAM (Gabriel Hernández / La Cienega)', center: { lat: 19.4850, lng: -99.1120 }, radius_m: 1000, level: 'Alto' },
  { zone_id: 'tepito', name: 'Tepito / Morelos', center: { lat: 19.4440, lng: -99.1250 }, radius_m: 800, level: 'Muy Alto' },
  { zone_id: 'doctores', name: 'Doctores / Buenos Aires', center: { lat: 19.4180, lng: -99.1480 }, radius_m: 900, level: 'Medio-Alto' },
  { zone_id: 'iztapalapa', name: 'Iztapalapa Centro', center: { lat: 19.3580, lng: -99.0920 }, radius_m: 1500, level: 'Alto' },
  { zone_id: 'ecatepec', name: 'Ecatepec (Límite GAM)', center: { lat: 19.5350, lng: -99.0250 }, radius_m: 1800, level: 'Alto' },
].map(zone => ({ ...zone, reference: true, severity: zone.level === 'Medio-Alto' ? 'YELLOW' : 'RED' }))

// Proyección sobre segmentos para elegir reincorporación ADELANTE, sin mover la posición.
export function distanceAlongRoute(position: Coordinate, path: Coordinate[]): number {
  let along = 0, best = 0, closest = Infinity
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i]
    const x = deltaLng(b.lng, a.lng) * Math.cos(position.lat * rad), y = b.lat - a.lat
    const px = deltaLng(position.lng, a.lng) * Math.cos(position.lat * rad), py = position.lat - a.lat
    const fraction = x * x + y * y ? Math.max(0, Math.min(1, (px * x + py * y) / (x * x + y * y))) : 0
    const length = distanceMeters(a, b)
    const projected = routePoint([a, b], length * fraction)!.point
    const separation = distanceMeters(position, projected)
    if (separation < closest) { closest = separation; best = along + length * fraction }
    along += length
  }
  return best
}

export function routeRemainder(path: Coordinate[], distance: number): Coordinate[] {
  const start = routePoint(path, distance)?.point
  if (!start) return []
  let along = 0
  const tail: Coordinate[] = [start]
  for (let i = 1; i < path.length; i++) {
    along += distanceMeters(path[i - 1], path[i])
    if (along > distance) tail.push(path[i])
  }
  return tail
}

export function riskReason(reason: string): string {
  return ({ SUDDEN_SPEED_INCREASE: 'Aumento brusco de velocidad detectado.', USER_REQUESTED_HELP: 'Se solicitó ayuda.',
    'Route deviation over 40 meters': 'Separación de la ruta mayor de 40 m.', 'Route deviation detected': 'Desviación de la ruta detectada.',
    'Significant route deviation': 'Desviación severa de la ruta.', 'High network latency': 'La conexión está respondiendo lentamente.',
    'High packet loss': 'Hay interrupciones en la conexión.', 'Low GPS accuracy': 'La ubicación tiene poca precisión.',
    'Network degraded': 'La conexión es inestable.' } as Record<string, string>)[reason] ?? reason
}

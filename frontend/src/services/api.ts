import type { AckStatus, Command, Coordinate, Journey, LoginResult, MonitorAccessRequest, MonitorContact, MonitorSnapshot, Registration, RoutePlan, Telemetry, TelemetryResult, User } from '../types'

export const ACCESS_TOKEN_KEY = 'guardian_access_token'

export function accessToken(): string | null {
  try { return localStorage.getItem(ACCESS_TOKEN_KEY) } catch { return null }
}

export class ApiError extends Error {
  constructor(message: string, public status = 0, public fields: Record<string, string> = {}) { super(message) }
}

const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
async function request<T>(path: string, body?: unknown, options: { auth?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  const abort = new AbortController()
  const cancel = () => abort.abort()
  options.signal?.addEventListener('abort', cancel, { once: true })
  if (options.signal?.aborted) cancel()
  const timer = setTimeout(() => abort.abort(), 12000)
  try {
    const headers: Record<string, string> = body === undefined ? {} : { 'Content-Type': 'application/json' }
    const token = options.auth === false ? null : accessToken()
    if (token) headers.Authorization = `Bearer ${token}`
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort.signal, cache: 'no-store', credentials: 'omit',
      ...(options.auth === false ? { referrerPolicy: 'no-referrer' as const } : {}),
    })
    const data = await response.json().catch(() => null)
    if (response.status >= 500) throw new ApiError('El servicio no está disponible. Intenta de nuevo más tarde.', response.status)
    if (!response.ok) throw new ApiError(data?.message || (typeof data?.detail === 'string' ? data.detail : 'El backend rechazó la solicitud.'), response.status, data?.errors)
    if (!data) throw new ApiError('El backend no devolvió JSON válido.', response.status)
    return data as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(error instanceof Error && error.name === 'AbortError' ? 'El backend no respondió a tiempo.' : 'No se pudo conectar con el backend.')
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel) }
}

export const api = {
  monitorContacts: (signal?: AbortSignal) => request<MonitorContact[]>('/api/monitor/contacts', undefined, { signal }),
  createMonitorAccess: (body: MonitorAccessRequest) => request<{ token: string }>('/api/monitor/access', body),
  sendMonitorTelegram: (journeyId: string, tutorId: number) => request<{ ok: boolean; sent: boolean; monitor_url: string }>('/api/monitor/send-telegram', { journey_id: journeyId, tutor_id: tutorId }),
  monitor: (token: string, signal?: AbortSignal) => request<MonitorSnapshot>(`/api/monitor/${encodeURIComponent(token)}`, undefined, { auth: false, signal }),
  sendCommand: (journey_id: string, user_id: string) => request<Command>('/api/commands', { journey_id, user_id, action: 'EMERGENCY_MODE', value: null }),
  planRoute: (origin: Coordinate, destination: Coordinate) => request<Omit<RoutePlan, 'destinationName' | 'destinationAddress'>>('/api/routes/plan', { origin, destination }),
  start: (user_id: string) => request<Journey>('/api/journeys/start', { user_id }),
  journey: (id: string) => request<Journey>(`/api/journeys/${encodeURIComponent(id)}`),
  stop: (id: string) => request<Journey>(`/api/journeys/${encodeURIComponent(id)}/stop`, {}),
  telemetry: (payload: Telemetry) => request<TelemetryResult>('/api/telemetry', payload),
  ack: (id: string, status: AckStatus, message: string) => request<unknown>(`/api/commands/${encodeURIComponent(id)}/ack`, { status, message }),
  register: (payload: Registration) => request<{success: boolean; message: string}>('/api/auth/register', payload),
  login: (email: string, password: string) => request<LoginResult>('/api/auth/login', { email, password }),
  me: () => request<User>('/api/auth/me'),
}

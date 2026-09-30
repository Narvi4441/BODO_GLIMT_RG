import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { offline } from '../src/services/offline'
import type { Telemetry } from '../src/types'

const point: Telemetry = { journey_id: 'test', user_id: 'device-test', latitude: 19.43, longitude: -99.13,
  accuracy: 12, speed: null, heading: null, battery: null, latency_ms: null, packet_loss: null,
  network_status: 'OFFLINE', route_deviation_m: null, timestamp: '2026-09-29T18:00:00Z' }
beforeEach(async () => { for (const item of await offline.all()) await offline.remove(item.id!); await offline.clearSession() })

describe('cola persistente IndexedDB', () => {
  it('conserva orden de puntos y ACK hasta borrado explícito tras envío', async () => {
    await offline.enqueue({ kind: 'telemetry', payload: point })
    await offline.enqueue({ kind: 'ack', command_id: 'command-1', payload: { status: 'RECEIVED', message: 'Recibido' } })
    await offline.enqueue({ kind: 'telemetry', payload: { ...point, timestamp: '2026-09-29T18:00:05Z' } })
    const first = await offline.first()
    expect(first?.kind).toBe('telemetry')
    expect(await offline.count()).toBe(3)
    // Volver a leer después de un envío fallido no elimina ni avanza la cola.
    expect(await offline.first()).toEqual(first)
    await offline.remove(first!.id!)
    expect((await offline.first())?.kind).toBe('ack')
    expect((await offline.all())[1]).toMatchObject({ payload: { timestamp: '2026-09-29T18:00:05Z' } })
  })
  it('persiste cierre pendiente para recuperar tras recargar offline', async () => {
    const saved = { journey: { journey_id: 'test', user_id: 'device-test', status: 'ACTIVE' as const, started_at: point.timestamp, ended_at: null }, stopPending: true }
    await offline.saveSession(saved)
    expect(await offline.session()).toEqual(saved)
    await offline.clearSession()
    expect(await offline.session()).toBeUndefined()
  })
})

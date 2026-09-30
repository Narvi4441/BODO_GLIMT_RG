import type { RealtimeEvent } from '../types'

export function websocketUrl(journeyId: string): string {
  const configured = import.meta.env.VITE_WS_URL || '/ws'
  const url = new URL(configured, location.href)
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:'
  url.pathname = url.pathname.replace(/\/$/, '') + '/journeys/' + encodeURIComponent(journeyId)
  return url.toString()
}

export class JourneySocket {
  private socket?: WebSocket
  private retry?: ReturnType<typeof setTimeout>
  private attempts = 0
  private closed = false
  constructor(private journey: string, private event: (event: RealtimeEvent) => void, private status: (connected: boolean) => void) { this.connect() }
  private connect() {
    if (this.closed) return
    if (!navigator.onLine) { this.status(false); this.schedule(); return }
    try {
      const socket = new WebSocket(websocketUrl(this.journey))
      this.socket = socket
      socket.onopen = () => { this.attempts = 0; this.status(true) }
      socket.onmessage = event => {
        try {
          const data = JSON.parse(event.data)
          if (['telemetry', 'command', 'command_ack'].includes(data.type) && data.data) this.event(data)
        } catch { /* Un mensaje inválido no debe detener la adquisición GPS. */ }
      }
      socket.onerror = () => socket.close()
      socket.onclose = () => { this.status(false); this.schedule() }
    } catch { this.status(false); this.schedule() }
  }
  private schedule() {
    if (!this.closed) this.retry = setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.attempts++, 10000))
  }
  close() {
    this.closed = true
    clearTimeout(this.retry)
    if (this.socket) { this.socket.onclose = null; this.socket.onopen = null; this.socket.onmessage = null; this.socket.onerror = null; this.socket.close() }
  }
}

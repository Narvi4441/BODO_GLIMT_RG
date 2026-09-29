import { useEffect, useRef, useState } from 'react'
import type { Snapshot, Telemetry } from './types'
export function useGuardian() {
  const [snapshot, setSnapshot] = useState<Snapshot>({ mqtt_connected: false, telemetry: null, received_at: 0, commands: [] })
  const [connected, setConnected] = useState(false)
  const [history, setHistory] = useState<Telemetry[]>([])
  const last = useRef(0)
  useEffect(() => {
    let disposed = false, socket: WebSocket, retry: ReturnType<typeof setTimeout>
    function connect() {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
      socket.onopen = () => { if (!disposed) setConnected(true) }
      socket.onmessage = event => {
        if (disposed) return
        const data: Snapshot = JSON.parse(event.data)
        setSnapshot(data)
        if (data.telemetry && data.telemetry.timestamp !== last.current) {
          last.current = data.telemetry.timestamp
          setHistory(previous => [...previous.slice(-59), data.telemetry!])
        }
      }
      socket.onclose = () => { if (!disposed) { setConnected(false); retry = setTimeout(connect, 1500) } }
      socket.onerror = () => socket.close()
    }
    connect()
    return () => { disposed = true; clearTimeout(retry); socket?.close() }
  }, [])
  return { snapshot, connected, history }
}

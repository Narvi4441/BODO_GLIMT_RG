import { useEffect, useRef, useState } from 'react'

export function CheckInModal({ answer, timeout, demo }: { answer: (ok: boolean) => void; timeout: () => void; demo: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [seconds, setSeconds] = useState(15)
  const resolved = useRef(false)
  const deadline = useRef(Date.now() + 15000)
  const timeoutRef = useRef(timeout)
  timeoutRef.current = timeout
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close() }, [])
  useEffect(() => {
    timer.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000))
      setSeconds(remaining)
      if (!remaining && !resolved.current) {
        resolved.current = true
        clearInterval(timer.current)
        timeoutRef.current()
      }
    }, 250)
    return () => clearInterval(timer.current)
  }, [demo])
  function respond(ok: boolean) {
    if (resolved.current) return
    resolved.current = true
    clearInterval(timer.current)
    answer(ok)
  }
  return <dialog ref={dialog} onCancel={event => event.preventDefault()} aria-labelledby="check-title">
    {demo && <p className="demo-banner">MODO DEMO — SIMULACIÓN DE TELEMETRÍA</p>}
    <span className="modal-icon">?</span><h2 id="check-title">¿Todo bien?</h2>
    <p>El centro de control solicita confirmar tu estado.</p>
    <p className="check-countdown" role="timer">{seconds} segundos</p>
    <button className="primary full" onClick={() => respond(true)}>Sí, estoy bien</button>
    <button className="danger full" onClick={() => respond(false)}>Necesito ayuda</button>
    <small>Tu respuesta se enviará como ACK. Esto no llama a servicios de emergencia.</small>
  </dialog>
}

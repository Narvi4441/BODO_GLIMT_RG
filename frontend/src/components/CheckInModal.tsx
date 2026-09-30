import { useEffect, useRef } from 'react'

export function CheckInModal({ answer }: { answer: (ok: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close() }, [])
  return <dialog ref={dialog} onCancel={event => event.preventDefault()} aria-labelledby="check-title">
    <span className="modal-icon">?</span><h2 id="check-title">¿Estás bien?</h2>
    <p>El centro de control solicita confirmar tu estado.</p>
    <button className="primary full" onClick={() => answer(true)}>Estoy bien</button>
    <button className="danger full" onClick={() => answer(false)}>Necesito ayuda</button>
    <small>Tu respuesta se enviará como ACK. Esto no llama a servicios de emergencia.</small>
  </dialog>
}

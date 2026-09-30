import type { DemoState } from '../types'

export function DemoControls({ state, change, exit }: {
  state: DemoState; change: (patch: Partial<DemoState>) => void; exit: () => void;
}) {
  return <section className="panel demo-controls" aria-label="Controles de simulación">
    <span className="eyebrow">SIMULACIÓN · SENSOR DEMO / BACKEND REAL</span>
    <h2>Demuestra el recorrido</h2>
    {!state.gpsAvailable && <p className="notice" role="alert">GPS DEMO no disponible. Movimiento y adquisición sintéticos pausados.</p>}
    <div className="demo-buttons">
      <button className="secondary" disabled={!state.gpsAvailable} onClick={() => change({ moving: !state.moving })}>{state.moving ? '⏸ Pausar movimiento' : state.distance ? '▶ Continuar' : '▶ Avanzar recorrido'}</button>
      <button className="secondary" disabled={!state.gpsAvailable} aria-pressed={state.offset === 150} onClick={() => change({ offset: 150 })}>↗ Desvío moderado (~150 m)</button>
      <button className="secondary" disabled={!state.gpsAvailable} aria-pressed={state.offset === 350} onClick={() => change({ offset: 350 })}>⚠ Desvío severo (&gt;300 m)</button>
      <button className="secondary" disabled={!state.gpsAvailable} onClick={() => change({ offset: 0 })}>↩ Regresar a ruta</button>
      <button className="secondary" onClick={() => change({ gpsAvailable: !state.gpsAvailable, moving: !state.gpsAvailable })}>{state.gpsAvailable ? '📡 Simular pérdida GPS' : '📍 Restaurar GPS'}</button>
      <button className="secondary" onClick={exit}>■ Salir del modo demo</button>
    </div>
    <p className="muted">Las posiciones sintéticas se envían y guardan en el backend real. No representan un desplazamiento real.</p>
  </section>
}

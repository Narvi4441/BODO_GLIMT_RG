import type { DemoState } from '../types'

export function DemoControls({
  state,
  change,
  exit,
}: {
  state: DemoState
  change: (patch: Partial<DemoState>) => void
  exit: () => void
}) {
  const moderateActive = state.offset === 150
  const severeActive = state.offset === 350

  return (
    <section className="demo-controls" aria-label="Controles de simulación">
      <span className="eyebrow">MODO DEMO</span>
      <h2>Simulación de telemetría</h2>

      {state.planning && (
        <p role="status">Buscando recorrido por calles…</p>
      )}

      {state.routeError && (
        <p className="notice" role="alert">
          {state.routeError}
        </p>
      )}

      {!state.gpsAvailable && (
        <p className="notice" role="alert">
          GPS DEMO no disponible. Movimiento y adquisición sintéticos pausados.
        </p>
      )}

      {(moderateActive || severeActive) && (
        <div
          className={`demo-deviation-status ${
            severeActive ? 'severe' : 'moderate'
          }`}
          role="status"
        >
          <strong>
            {severeActive
              ? '⚠ Desvío severo activo'
              : '↗ Desvío moderado activo'}
          </strong>

          <span>
            {severeActive
              ? 'Trayectoria fuera de la ruta planeada (>300 m)'
              : 'Trayectoria fuera de la ruta planeada (~150 m)'}
          </span>
        </div>
      )}

      <fieldset className="demo-buttons">
        <legend>Movimiento</legend>

        <button
          className="secondary"
          disabled={!state.gpsAvailable || state.planning}
          onClick={() => change({ moving: !state.moving })}
        >
          {state.moving
            ? 'Ⅱ Pausar movimiento'
            : state.distance
              ? '▶ Continuar'
              : '▶ Avanzar recorrido'}
        </button>
      </fieldset>

      <fieldset className="demo-buttons">
        <legend>Escenarios</legend>

        <button
          className={`secondary demo-scenario ${
            moderateActive ? 'active moderate' : ''
          }`}
          disabled={!state.gpsAvailable || state.planning}
          aria-pressed={moderateActive}
          onClick={() => change({ offset: 150 })}
        >
          ↗ Desvío moderado (~150 m)
          {moderateActive && <span className="scenario-active-label">ACTIVO</span>}
        </button>

        <button
          className={`secondary demo-scenario ${
            severeActive ? 'active severe' : ''
          }`}
          disabled={!state.gpsAvailable || state.planning}
          aria-pressed={severeActive}
          onClick={() => change({ offset: 350 })}
        >
          ⚠ Desvío severo (&gt;300 m)
          {severeActive && <span className="scenario-active-label">ACTIVO</span>}
        </button>

        <button
          className="secondary"
          disabled={!state.gpsAvailable || state.planning}
          onClick={() => change({ offset: 0 })}
        >
          ↩ Regresar a ruta
        </button>
      </fieldset>

      <fieldset className="demo-buttons">
        <legend>Sensores</legend>

        <button
          className="secondary"
          onClick={() =>
            change({
              gpsAvailable: !state.gpsAvailable,
              moving: !state.gpsAvailable,
            })
          }
        >
          {state.gpsAvailable
            ? '📡 Simular pérdida GPS'
            : '📡 Restaurar GPS'}
        </button>
      </fieldset>

      <button
        className="secondary full demo-exit"
        onClick={exit}
      >
        ■ Salir del modo demo
      </button>

      <p className="muted">
        Las posiciones sintéticas se envían y guardan en el backend real.
        No representan un desplazamiento real.
      </p>
    </section>
  )
}
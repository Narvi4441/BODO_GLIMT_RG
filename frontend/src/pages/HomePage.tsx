import type { JourneyState } from '../services/telemetry'
import type { User } from '../types'

export function HomePage({ state, user, start, account }: { state: JourneyState; user: User | null; start: () => void; account: () => void }) {
  return <>
    <section className="hero panel">
      <span className="eyebrow">CONTIGO EN CADA TRAYECTO</span>
      <div className="hero-shield"><svg viewBox="0 0 80 90" fill="none" aria-hidden="true"><path d="M40 6 69 18v26c0 20-13 32-29 39C24 76 11 64 11 44V18Z" stroke="currentColor" strokeWidth="3"/><path d="m26 43 10 10 20-24" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></svg><span className="orb one"/><span className="orb two"/></div>
      <h1>Tu camino.<br/><span>Siempre acompañado.</span></h1>
      <p>Comparte la ubicación de tu trayecto con el centro de control y responde a sus indicaciones.</p>
      <button className="primary full" disabled={!user || !window.isSecureContext || !state.ready || state.busy || state.network === 'OFFLINE' || !!state.storageError} onClick={start}>{state.busy ? 'Solicitando GPS e iniciando…' : 'Iniciar trayecto protegido'} <span>↗</span></button>
      <small>{user ? 'Se solicitará permiso de ubicación al iniciar.' : 'Inicia sesión para iniciar un trayecto.'}</small>
    </section>
    <section className="panel identity"><div><span className="eyebrow">IDENTIDAD DEL TRAYECTO</span><h3>{user ? user.nombre_completo : 'Sin sesión'}</h3><p>{user ? user.email : 'Accede con tu cuenta para iniciar un trayecto.'}</p></div><button className="text-button" onClick={account}>{user ? 'Cuenta' : 'Acceder →'}</button></section>
    <div className="features"><article className="panel"><span>◎</span><h3>Ubicación real</h3><p>GPS del teléfono, con tu permiso.</p></article><article className="panel"><span>⇅</span><h3>Datos a salvo</h3><p>Buffer local si pierdes conexión.</p></article></div>
    <p className="footnote">Mantén GUARDIAN abierto durante el trayecto. El navegador puede suspender el GPS con la pantalla bloqueada o la app en segundo plano.</p>
  </>
}

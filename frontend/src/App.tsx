import { useEffect, useState } from 'react'
import { api, ApiError, accessToken, ACCESS_TOKEN_KEY } from './services/api'
import { useJourney } from './hooks/useJourney'
import { guardian } from './services/telemetry'
import { HomePage } from './pages/HomePage'
import { ActiveJourney } from './pages/ActiveJourney'
import { AuthPage } from './pages/AuthPage'
import { CheckInModal } from './components/CheckInModal'
import { InstallPrompt } from './components/InstallPrompt'
import type { User } from './types'

function deviceId() {
  let id = localStorage.getItem('guardian-device-id')
  if (!id) { id = `device-${crypto.randomUUID()}`; localStorage.setItem('guardian-device-id', id) }
  return id
}
function lightPreference() {
  try { return localStorage.getItem('guardian-theme') === 'light' } catch { return false }
}
export default function App() {
  const s = useJourney()
  const [user, setUser] = useState<User | null>(null)
  const [account, setAccount] = useState(false)
  const [error, setError] = useState('')
  const [light, setLight] = useState(lightPreference)
  const [restoring, setRestoring] = useState(() => !!accessToken())
  const [authError, setAuthError] = useState('')
  const [restoreAttempt, setRestoreAttempt] = useState(0)
  useEffect(() => {
    if (!accessToken()) { setRestoring(false); return }
    let cancelled = false
    setRestoring(true)
    setAuthError('')
    void api.me().then(value => {
      if (!cancelled) setUser(value)
    }).catch(error => {
      if (cancelled) return
      if (error instanceof ApiError && error.status === 401) {
        try { localStorage.removeItem(ACCESS_TOKEN_KEY) }
        catch { setAuthError('No se pudo borrar la sesión del navegador.') }
        setUser(null)
        setAccount(true)
      } else {
        setAuthError(error instanceof Error ? error.message : 'No se pudo recuperar la sesión.')
      }
    }).finally(() => { if (!cancelled) setRestoring(false) })
    return () => { cancelled = true }
  }, [restoreAttempt])
  function logout() {
    try { localStorage.removeItem(ACCESS_TOKEN_KEY) }
    catch { setAuthError('No se pudo borrar la sesión. Revisa el almacenamiento del navegador.'); return }
    setUser(null)
    setAuthError('')
    setAccount(true)
  }
  async function start() {
    try { await guardian.start(user ? String(user.id_usuario) : deviceId()) }
    catch { setError('El almacenamiento local no está disponible. Habilítalo para iniciar.') }
  }
  return <div className={`app-shell ${light ? 'light' : ''}`}>
    <header><a className="brand" href="/" aria-label="GUARDIAN Core inicio" onClick={event => { event.preventDefault(); setAccount(false) }}><img src="/icon.svg" alt=""/> <span>GUARDIAN <small>CORE</small></span></a><button className="theme" aria-label="Cambiar tema" onClick={() => { setLight(!light); localStorage.setItem('guardian-theme', light ? 'dark' : 'light') }}>{light ? '☾' : '☀'}</button></header>
    <main><div className="system-line"><span className={`network ${s.network}`}><i/>{s.network === 'OFFLINE' ? 'Sin conexión · OFFLINE' : s.network}</span><span>{s.acquiring ? 'TRAYECTO ACTIVO' : 'TELEMETRÍA URBANA'}</span></div>
      {!window.isSecureContext && <p className="notice" role="alert">Para usar GPS e instalar la PWA desde tu teléfono, abre esta página con HTTPS confiable.</p>}
      {(s.error || error) && <p className="notice" role="alert">{s.error || error}</p>}
      {s.gpsError && <p className="notice" role="alert">{s.gpsError}</p>}
      {s.storageError && <p className="notice" role="alert">{s.storageError}</p>}
      {authError && <p className="notice" role="alert">{authError} <button className="text-button" disabled={restoring} onClick={() => setRestoreAttempt(value => value + 1)}>Reintentar sesión</button></p>}
      {s.pending > 0 && <section className="buffer panel"><div><strong>{s.pending} pendientes</strong><p>Puntos GPS y confirmaciones guardados localmente.</p></div><button className="text-button" onClick={() => void guardian.sync()}>Reintentar</button><button className="text-button" onClick={() => void guardian.downloadPending().catch(() => setError('No se pudo exportar el buffer.'))}>Descargar</button></section>}
      {s.recovered > 0 && <p className="success" role="status">✓ {s.recovered} puntos recuperados y confirmados por el backend.</p>}
      {s.journey ? <ActiveJourney state={s} stop={() => void guardian.stop()} resume={() => void guardian.resume()}/> : restoring ? <p className="notice" role="status">Restaurando sesión…</p> : account ? (user ? <section className="panel"><h1>{user.nombre_completo}</h1><p>{user.email}</p><button className="secondary" onClick={logout}>Cerrar sesión</button><button className="text-button" onClick={() => setAccount(false)}>Volver</button></section> : <AuthPage back={() => setAccount(false)} loggedIn={value => { setUser(value); setAuthError(''); setAccount(false) }}/>) : <HomePage state={s} user={user} start={() => void start()} account={() => setAccount(true)}/>}
      <InstallPrompt active={!!s.journey}/>
      <footer>GUARDIAN CORE <span>Tu seguridad, en movimiento.</span></footer>
    </main>
    {s.checkIn && <CheckInModal answer={ok => void guardian.answerCheckIn(ok)}/>}
  </div>
}

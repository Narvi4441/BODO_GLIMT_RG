import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
export function InstallPrompt({ active }: { active: boolean }) {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null)
  const [installed, setInstalled] = useState(matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)
  const { needRefresh: [refresh], offlineReady: [ready], updateServiceWorker } = useRegisterSW()
  useEffect(() => {
    const before = (event: Event) => { event.preventDefault(); setPrompt(event as InstallEvent) }
    const complete = () => { setInstalled(true); setPrompt(null) }
    window.addEventListener('beforeinstallprompt', before); window.addEventListener('appinstalled', complete)
    return () => { window.removeEventListener('beforeinstallprompt', before); window.removeEventListener('appinstalled', complete) }
  }, [])
  return <div className="install-box">
    {refresh && <p>Actualización disponible. {active ? 'Podrás aplicarla al finalizar el trayecto.' : <button className="text-button" onClick={() => void updateServiceWorker(true)}>Actualizar aplicación</button>}</p>}
    {!installed && (prompt ? <button className="secondary full" onClick={async () => { await prompt.prompt(); await prompt.userChoice; setPrompt(null) }}>＋ Instalar GUARDIAN</button> : <p>Instalar: menú del navegador → Instalar aplicación. En iPhone: Safari → Compartir → Añadir a pantalla de inicio.</p>)}
    <small>{ready ? 'Interfaz disponible sin conexión' : 'La instalación y el GPS requieren HTTPS confiable.'}</small>
  </div>
}

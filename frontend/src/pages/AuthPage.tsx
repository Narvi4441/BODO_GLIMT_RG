import { useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError, ACCESS_TOKEN_KEY } from '../services/api'
import type { Registration, User } from '../types'

const fields = [
  ['nombre_completo', 'Nombre completo', 'text', 'name'], ['telefono', 'Teléfono', 'tel', 'tel'],
  ['email', 'Correo electrónico', 'email', 'email'], ['password', 'Contraseña', 'password', 'new-password'],
  ['confirm_password', 'Confirmar contraseña', 'password', 'new-password'],
  ['tutor.nombre_completo', 'Nombre del tutor', 'text', 'section-tutor name'],
  ['tutor.telefono', 'Teléfono del tutor', 'tel', 'section-tutor tel'],
  ['tutor.email', 'Correo del tutor', 'email', 'section-tutor email'], ['tutor.relacion', 'Relación con el usuario', 'text', 'off'],
]

export function AuthPage({ back, loggedIn }: { back: () => void; loggedIn: (user: User) => void }) {
  const [register, setRegister] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return
    const form = event.currentTarget
    setMessage(''); setErrors({})
    let payload: Registration | undefined
    if (register) {
      const data = new FormData(form)
      const value = (key: string) => String(data.get(key) || '')
      payload = { nombre_completo: value('nombre_completo').trim(), telefono: value('telefono').trim(), email: value('email').trim(), password: value('password'), confirm_password: value('confirm_password'), tutor: { nombre_completo: value('tutor.nombre_completo').trim(), telefono: value('tutor.telefono').trim(), email: value('tutor.email').trim(), relacion: value('tutor.relacion').trim() } }
      const issues: Record<string, string> = {}
      for (const [prefix, person] of [['', payload], ['tutor.', payload.tutor]] as const) {
        if (!person.nombre_completo) issues[prefix + 'nombre_completo'] = 'El nombre es obligatorio.'
        if (!/^\+?[0-9 ()\-.]+$/.test(person.telefono) || !/^[0-9]{10,15}$/.test(person.telefono.replace(/[^0-9]/g, ''))) issues[prefix + 'telefono'] = 'Ingresa un teléfono válido de 10 a 15 dígitos.'
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email)) issues[prefix + 'email'] = 'Ingresa un correo electrónico válido.'
      }
      if ([...payload.password].length < 8 || !payload.password.trim()) issues.password = 'La contraseña debe tener al menos 8 caracteres y no contener solo espacios.'
      if (payload.password !== payload.confirm_password) issues.confirm_password = 'Las contraseñas no coinciden.'
      if (!payload.tutor.relacion) issues['tutor.relacion'] = 'Indica la relación con el usuario.'
      if (Object.keys(issues).length) { setErrors(issues); return }
    }
    if (!navigator.onLine) { setMessage('Necesitas conexión para acceder o crear una cuenta.'); return }
    setBusy(true)
    try {
      if (payload) {
        await api.register(payload)
        setEmail(payload.email.toLowerCase()); setPassword(''); setRegister(false)
        setMessage('Usuario registrado correctamente. Ya puedes iniciar sesión.')
      } else {
        const response = await api.login(email.trim(), password)
        if (response.success && response.access_token) {
          try { localStorage.setItem(ACCESS_TOKEN_KEY, response.access_token) }
          catch { throw new Error('No se pudo guardar la sesión. Habilita el almacenamiento del navegador.') }
          loggedIn(response.user)
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo completar la operación.')
      if (error instanceof ApiError) setErrors(error.fields)
    } finally { setBusy(false) }
  }
  return <section className="panel auth-page">
    <button className="text-button" disabled={busy} onClick={back}>← Volver</button>
    <p className="eyebrow">TU CUENTA GUARDIAN</p><h1>{register ? 'Crear cuenta' : 'Bienvenido de nuevo'}</h1>
    <p className="muted">{register ? 'Se conserva el registro de usuario y tutor del backend existente.' : 'Verifica tus credenciales con el backend.'}</p>
    <form key={String(register)} onSubmit={submit} noValidate={register}>
      <fieldset disabled={busy}>
        {register ? fields.map(([name, label, type, autocomplete], index) => <div key={name}>
          {index === 5 && <h3>Tutor del registro existente</h3>}
          <label htmlFor={name}>{label}</label><input id={name} name={name} type={type} autoComplete={autocomplete} required maxLength={type === 'password' ? 128 : name.includes('email') ? 100 : name.includes('telefono') ? 30 : name.includes('relacion') ? 50 : 150} aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${name}-error` : undefined}/>
          {errors[name] && <p className="field-error" id={`${name}-error`}>{errors[name]}</p>}
        </div>) : <><label htmlFor="login-email">Correo</label><input id="login-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)}/><label htmlFor="login-password">Contraseña</label><input id="login-password" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={e => setPassword(e.target.value)}/></>}
        {message && <p className="notice" role="status">{message}</p>}
        <button className="primary full" type="submit">{busy ? 'Conectando…' : register ? 'Crear cuenta' : 'Iniciar sesión'}</button>
      </fieldset>
    </form>
    <button disabled={busy} className="text-button full" onClick={() => { setRegister(!register); setPassword(''); setMessage(''); setErrors({}) }}>{register ? 'Ya tengo cuenta' : 'Crear cuenta'}</button>
    {!register && <button className="text-button full muted" onClick={() => setMessage('La recuperación por correo todavía no está disponible. No se ha enviado ningún mensaje.')}>¿Olvidaste tu contraseña?</button>}
  </section>
}

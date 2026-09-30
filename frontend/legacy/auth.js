/* Registro y verificación de credenciales. Sin secretos, roles ni caché de cuentas. */
'use strict';
window.initGuardianAuth = function ({ $, $$, hid, profile, enterApp, notice, setLogin }) {
let role = 'user', mode = 'login';
let authBusy = false;
const registrationFields = {
  nombre_completo: 'regName', telefono: 'regPhone', email: 'regEmail',
  password: 'regPassword', confirm_password: 'regConfirm',
  'tutor.nombre_completo': 'regTutorName', 'tutor.telefono': 'regTutorPhone',
  'tutor.email': 'regTutorEmail', 'tutor.relacion': 'regRelation'
};
Object.values(registrationFields).forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    document.getElementById(id).removeAttribute('aria-invalid');
    accountMessage(id + 'Err');
  });
});

function accountMessage(id, message = '', bad = false) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.classList.toggle('hidden-x', !message);
  el.style.color = bad ? '#EF4444' : '';
}

function clearRegistrationErrors() {
  Object.values(registrationFields).forEach(id => {
    document.getElementById(id).removeAttribute('aria-invalid');
    accountMessage(id + 'Err');
  });
  accountMessage('registerMessage');
}

function registrationErrors(errors) {
  let first;
  Object.entries(errors).forEach(([field, message]) => {
    const id = registrationFields[field];
    if (!id) return;
    const input = document.getElementById(id);
    input.setAttribute('aria-invalid', 'true');
    accountMessage(id + 'Err', message, true);
    first ||= input;
  });
  first?.focus();
}

function resetAccountViews() {
  mode = 'login'; role = 'user';
  hid($('#registerForm'), true); hid($('#loginForm'), false);
  $('#registerForm').reset(); clearRegistrationErrors();
  $('#pw').value = ''; $('#pw').type = 'password';
  $$('#roles button').forEach(button => button.classList.toggle('on', button.dataset.role === 'user'));
  renderLoginMode(); accountMessage('loginMessage');
}

function renderLoginMode() {
  const recover = mode === 'recover', admin = role === 'admin' && !recover;
  $('#loginTitle').textContent = recover ? 'RECUPERAR CUENTA' : 'ACCESO';
  $('#loginSub').textContent = recover ? 'Recuperación por correo aún no disponible.' : admin ? 'Vista de demostración. No autentica ni concede permisos administrativos.' : 'Inicia sesión con tu cuenta registrada.';
  hid($('#roles'), recover); hid($('#emBox'), admin); hid($('#pwBox'), recover || admin);
  hid($('#sentMsg'), !recover); hid($('#emErr'), true); hid($('#loginPwErr'), true);
  hid($('#recoverLink'), admin); hid($('#createAccount'), recover);
  $('#loginBtn').textContent = recover ? 'Recuperación no disponible' : admin ? 'Abrir demo de administrador' : 'Iniciar Sesión';
  $('#loginBtn').disabled = recover;
  $('#recoverLink').textContent = recover ? '← Volver al login' : '¿Olvidaste tu contraseña?';
}

function busyAccount(on) {
  authBusy = on;
  $$('#login button, #login input').forEach(el => { el.disabled = on; });
  if (!on) renderLoginMode();
}

async function accountRequest(path, data) {
  if (location.protocol === 'file:') throw new Error('Abre la aplicación desde http://localhost:8000/ui/, no como archivo local.');
  const configured = document.querySelector('meta[name="guardian-api-base"]')?.content.trim();
  const base = configured || (['5500', '5501'].includes(location.port) ? `${location.protocol}//${location.hostname}:8000` : '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/api/auth/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data), cache: 'no-store', credentials: 'omit', signal: controller.signal
    });
    let body;
    try { body = await response.json(); }
    catch { throw new Error('El backend no devolvió una respuesta válida.'); }
    if (!response.ok || body.success !== true) {
      const error = new Error(body.message || 'No se pudo completar la operación. Intenta nuevamente.');
      error.fields = body.errors || {};
      throw error;
    }
    return body;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('La solicitud tardó demasiado. Si intentabas registrarte, prueba iniciar sesión antes de volver a crear la cuenta.');
    if (error instanceof TypeError) throw new Error('No se pudo conectar con el backend. Revisa tu conexión e intenta nuevamente.');
    throw error;
  } finally { clearTimeout(timeout); }
}

$('#createAccount').onclick = () => {
  if (authBusy) return;
  $('#registerForm').reset(); clearRegistrationErrors();
  $('#regEmail').value = $('#em').value.trim();
  $('#pw').value = '';
  hid($('#loginForm'), true); hid($('#registerForm'), false);
  $('#regName').focus();
};
$('#registerBack').onclick = () => { if (!authBusy) { resetAccountViews(); $('#em').focus(); } };
$('#registerClose').onclick = () => { if (!authBusy) { resetAccountViews(); setLogin(false); } };
$('#pwEye').onclick = () => { $('#pw').type = $('#pw').type === 'password' ? 'text' : 'password'; };
$$('#roles button').forEach(button => button.onclick = () => {
  role = button.dataset.role; $('#pw').value = '';
  $$('#roles button').forEach(el => el.classList.toggle('on', el === button));
  accountMessage('loginMessage'); renderLoginMode();
});
$('#recoverLink').onclick = () => {
  mode = mode === 'login' ? 'recover' : 'login';
  accountMessage('loginMessage'); renderLoginMode();
};

$('#registerForm').addEventListener('submit', async event => {
  event.preventDefault(); if (authBusy) return;
  clearRegistrationErrors();
  const value = id => document.getElementById(id).value.trim();
  const data = {
    nombre_completo: value('regName'), telefono: value('regPhone'), email: value('regEmail'),
    password: $('#regPassword').value, confirm_password: $('#regConfirm').value,
    tutor: { nombre_completo: value('regTutorName'), telefono: value('regTutorPhone'), email: value('regTutorEmail'), relacion: value('regRelation') }
  };
  const errors = {};
  for (const [prefix, person] of [['', data], ['tutor.', data.tutor]]) {
    if (!person.nombre_completo) errors[prefix + 'nombre_completo'] = 'El nombre es obligatorio.';
    if (!/^\+?[0-9 ()\-.]+$/.test(person.telefono) || !/^[0-9]{10,15}$/.test(person.telefono.replace(/[^0-9]/g, ''))) errors[prefix + 'telefono'] = 'Ingresa un teléfono válido de 10 a 15 dígitos.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email)) errors[prefix + 'email'] = 'Ingresa un correo electrónico válido.';
  }
  if ([...data.password].length < 8) errors.password = 'La contraseña debe tener al menos 8 caracteres.';
  else if (!data.password.trim()) errors.password = 'La contraseña no puede contener solo espacios.';
  else if ([...data.password].length > 128) errors.password = 'La contraseña debe tener como máximo 128 caracteres.';
  if (data.password !== data.confirm_password) errors.confirm_password = 'Las contraseñas no coinciden.';
  if (!data.tutor.relacion) errors['tutor.relacion'] = 'Indica la relación con el usuario.';
  if (Object.keys(errors).length) { registrationErrors(errors); return; }
  busyAccount(true); $('#registerBtn').textContent = 'Creando cuenta…';
  let registered = false;
  try {
    await accountRequest('register', data); registered = true;
  } catch (error) {
    registrationErrors(error.fields || {});
    accountMessage('registerMessage', error.message || 'No se pudo crear la cuenta. Intenta nuevamente.', true);
  } finally { busyAccount(false); $('#registerBtn').textContent = 'Crear cuenta'; }
  if (registered) {
    resetAccountViews(); $('#em').value = data.email.toLowerCase();
    accountMessage('loginMessage', 'Usuario registrado correctamente. Ya puedes iniciar sesión.');
    $('#pw').focus();
  } else {
    $('#registerForm [aria-invalid=true]')?.focus();
  }
});

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault(); if (authBusy || mode === 'recover') return;
  if (role === 'admin') {
    enterApp('admin', 'demo@guardian.local');
    notice('Consola administrativa de demostración. Sin permisos reales.');
    return;
  }
  accountMessage('loginMessage');
  const email = $('#em').value.trim(), password = $('#pw').value;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  hid($('#emErr'), emailOk); hid($('#loginPwErr'), !!password);
  if (!emailOk || !password) { (!emailOk ? $('#em') : $('#pw')).focus(); return; }
  busyAccount(true); $('#loginBtn').textContent = 'Verificando…';
  let result;
  try { result = await accountRequest('login', { email, password }); }
  catch (error) { accountMessage('loginMessage', error.message, true); }
  finally { busyAccount(false); }
  if (result) {
    profile.name = result.usuario.nombre_completo; profile.email = result.usuario.email; profile.photo = null;
    $('#pName').textContent = profile.name;
    const initials = profile.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    ['#avatarU', '#avatarBig'].forEach(id => { $(id).textContent = initials; });
    const tutor = result.tutores[0];
    $('#tName').value = tutor?.nombre_completo || ''; $('#tPhone').value = tutor?.telefono || '';
    $('#pw').value = ''; enterApp('user', profile.email);
  }
});

$$('[data-logout]').forEach(button => button.addEventListener('click', () => {
  resetAccountViews(); profile.name = ''; profile.email = ''; profile.photo = null;
  $('#tName').value = ''; $('#tPhone').value = '';
  hid($('#profileMenu'), true);
}));
renderLoginMode();
return { resetAccountViews, isBusy: () => authBusy };
};

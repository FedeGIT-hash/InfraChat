import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const el = (id) => document.getElementById(id);

const ui = {
  tabLogin: el('tab-login'),
  tabRegistro: el('tab-registro'),
  panelLogin: el('panel-login'),
  panelRegistro: el('panel-registro'),

  loginForm: el('loginForm'),
  loginEmail: el('loginEmail'),
  loginPassword: el('loginPassword'),
  loginBtn: el('loginBtn'),
  authHint: el('authHint'),

  signupForm: el('signupForm'),
  signupEmail: el('signupEmail'),
  signupPassword: el('signupPassword'),
  signupUsername: el('signupUsername'),
  signupBtn: el('signupBtn'),
  signupHint: el('signupHint'),
};

const state = {
  config: null,
  supabase: null,
  session: null,
};

function setHint(target, text, tone = 'muted') {
  target.textContent = text || '';
  if (!text) return;
  if (tone === 'error') target.style.color = 'rgba(255, 180, 180, 0.95)';
  if (tone === 'ok') target.style.color = 'rgba(170, 255, 200, 0.95)';
  if (tone === 'muted') target.style.color = '';
}

function switchTab(tab) {
  const isLogin = tab === 'login';
  ui.tabLogin.classList.toggle('active', isLogin);
  ui.tabRegistro.classList.toggle('active', !isLogin);
  ui.tabLogin.setAttribute('aria-selected', String(isLogin));
  ui.tabRegistro.setAttribute('aria-selected', String(!isLogin));
  ui.panelLogin.classList.toggle('active', isLogin);
  ui.panelRegistro.classList.toggle('active', !isLogin);
  setHint(ui.authHint, '');
  setHint(ui.signupHint, '');
}

function goToMensajes() {
  window.location.assign('/mensajes.html');
}

async function signIn(email, password) {
  ui.loginBtn.disabled = true;
  setHint(ui.authHint, 'Verificando…');

  const { data, error } = await state.supabase.auth.signInWithPassword({
    email: String(email || '').trim(),
    password: String(password || ''),
  });

  ui.loginBtn.disabled = false;
  if (error) throw error;
  state.session = data.session;
}

async function signUp(email, password, username) {
  const cleanEmail = String(email || '').trim();
  const cleanPassword = String(password || '');
  const cleanUsername = String(username || '').trim();

  if (!cleanEmail) throw new Error('Email requerido.');
  if (!cleanPassword || cleanPassword.length < 6) throw new Error('Contraseña mínimo 6 caracteres.');
  if (!cleanUsername) throw new Error('Username requerido.');

  ui.signupBtn.disabled = true;
  setHint(ui.signupHint, 'Creando cuenta…');

  const { data, error } = await state.supabase.auth.signUp({
    email: cleanEmail,
    password: cleanPassword,
    options: { data: { username: cleanUsername } },
  });

  ui.signupBtn.disabled = false;
  if (error) throw error;

  if (data?.session) {
    state.session = data.session;
    return;
  }

  try {
    await signIn(cleanEmail, cleanPassword);
  } catch {
    setHint(
      ui.signupHint,
      'Cuenta creada. Si tienes confirmación por email activada en Supabase, revisa tu correo y luego haz login.',
      'ok',
    );
    switchTab('login');
  }
}

function wireUi() {
  ui.tabLogin.addEventListener('click', () => switchTab('login'));
  ui.tabRegistro.addEventListener('click', () => switchTab('registro'));

  ui.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await signIn(ui.loginEmail.value, ui.loginPassword.value);
      setHint(ui.authHint, 'Entrando…', 'ok');
      goToMensajes();
    } catch (err) {
      setHint(ui.authHint, err?.message || 'Login falló.', 'error');
    }
  });

  ui.signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.config?.enableSignup) return;
    try {
      await signUp(ui.signupEmail.value, ui.signupPassword.value, ui.signupUsername.value);
      if (state.session) goToMensajes();
    } catch (err) {
      setHint(ui.signupHint, err?.message || 'Registro falló.', 'error');
    }
  });
}

async function init() {
  wireUi();
  switchTab('login');

  const res = await fetch('/api/config', { cache: 'no-store' });
  state.config = await res.json();

  if (!state.config?.supabaseUrl || !state.config?.supabaseAnonKey) {
    ui.loginBtn.disabled = true;
    ui.signupBtn.disabled = true;
    setHint(ui.authHint, 'Falta configurar SUPABASE_URL y SUPABASE_ANON_KEY en Vercel.', 'error');
    return;
  }

  ui.signupBtn.disabled = !state.config.enableSignup;
  if (!state.config.enableSignup) setHint(ui.signupHint, 'Registro desactivado.', 'muted');

  state.supabase = createClient(state.config.supabaseUrl, state.config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const { data } = await state.supabase.auth.getSession();
  state.session = data.session;
  if (state.session) {
    goToMensajes();
    return;
  }

  state.supabase.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    if (session) goToMensajes();
  });
}

init();


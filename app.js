import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const el = (id) => document.getElementById(id);

const ui = {
  authPage: document.querySelector('[data-page="auth"]'),
  appPage: document.querySelector('[data-page="app"]'),
  appRoot: document.querySelector('.app'),

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

  meLine: el('meLine'),
  roomName: el('roomName'),
  roomStatus: el('roomStatus'),
  messages: el('messages'),
  sendForm: el('sendForm'),
  msgInput: el('msgInput'),
  sendBtn: el('sendBtn'),
  signOutBtn: el('signOutBtn'),

  usersList: el('usersList'),
  userSearch: el('userSearch'),
  openSidebarBtn: el('openSidebarBtn'),
  closeSidebarBtn: el('closeSidebarBtn'),
};

const state = {
  config: null,
  supabase: null,
  room: 'general',
  profile: null,
  session: null,
  users: [],
  realtimeChannel: null,
  seenMessageIds: new Set(),
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

function showAuth() {
  ui.appPage.classList.add('hidden');
  ui.authPage.classList.remove('hidden');
  ui.loginPassword.value = '';
  state.profile = null;
  state.seenMessageIds = new Set();
  teardownRealtime();
}

function showApp() {
  ui.authPage.classList.add('hidden');
  ui.appPage.classList.remove('hidden');
  requestAnimationFrame(() => scrollMessagesToBottom());
}

function scrollMessagesToBottom() {
  ui.messages.scrollTop = ui.messages.scrollHeight;
}

function isNearBottom(container, thresholdPx = 120) {
  const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
  return distance <= thresholdPx;
}

function formatTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function firstLetter(name) {
  const v = String(name || '').trim();
  return v ? v[0].toUpperCase() : '?';
}

function addSystemMessage(text) {
  const msg = document.createElement('div');
  msg.className = 'msg system';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  msg.appendChild(bubble);
  ui.messages.appendChild(msg);
}

function renderMessage(row) {
  if (!row || state.seenMessageIds.has(row.id)) return;
  state.seenMessageIds.add(row.id);

  const shouldStick = isNearBottom(ui.messages);

  const isMine = state.session?.user?.id && row.user_id === state.session.user.id;
  const msg = document.createElement('div');
  msg.className = `msg ${isMine ? 'sent' : 'recv'}`;

  if (!isMine) {
    const sender = document.createElement('div');
    sender.className = 'msg-sender';
    sender.textContent = row.username || 'Usuario';
    msg.appendChild(sender);
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = row.contenido || '';
  msg.appendChild(bubble);

  const time = document.createElement('div');
  time.className = 'msg-time';
  time.textContent = formatTime(row.created_at);
  msg.appendChild(time);

  ui.messages.appendChild(msg);

  if (shouldStick) scrollMessagesToBottom();
}

function renderUsers(users) {
  ui.usersList.innerHTML = '';

  const meId = state.session?.user?.id || null;
  const filtered = users.filter((u) => {
    const q = String(ui.userSearch.value || '').trim().toLowerCase();
    if (!q) return true;
    return String(u.username || '').toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'contact';
    const info = document.createElement('div');
    info.className = 'contact-info';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = 'Sin resultados';
    const preview = document.createElement('div');
    preview.className = 'preview';
    preview.textContent = 'Prueba con otro nombre…';
    info.appendChild(name);
    info.appendChild(preview);
    empty.appendChild(info);
    ui.usersList.appendChild(empty);
    return;
  }

  for (const u of filtered) {
    const row = document.createElement('div');
    row.className = 'contact';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = firstLetter(u.username);

    const info = document.createElement('div');
    info.className = 'contact-info';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = u.username + (u.id === meId ? ' (tú)' : '');

    const preview = document.createElement('div');
    preview.className = 'preview';
    preview.textContent = u.id === meId ? 'Tu perfil' : 'Usuario registrado';

    info.appendChild(name);
    info.appendChild(preview);
    row.appendChild(avatar);
    row.appendChild(info);
    ui.usersList.appendChild(row);
  }
}

async function loadUsers() {
  const { data, error } = await state.supabase
    .from('usuarios')
    .select('id, username, created_at')
    .order('username', { ascending: true });

  if (error) return;
  state.users = Array.isArray(data) ? data : [];
  renderUsers(state.users);
}

async function loadProfile() {
  const userId = state.session?.user?.id;
  if (!userId) throw new Error('Sesión inválida');

  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, error } = await state.supabase
      .from('usuarios')
      .select('id, username')
      .eq('id', userId)
      .maybeSingle();

    if (!error && data) {
      state.profile = data;
      ui.meLine.textContent = `@${data.username}`;
      return;
    }

    lastError = error;
    await new Promise((r) => setTimeout(r, 350));
  }

  if (lastError) throw lastError;
  await state.supabase.auth.signOut();
  throw new Error('Tu cuenta aún no tiene perfil en public.usuarios. Falta el trigger de creación automática.');

}

async function loadMessages() {
  state.seenMessageIds = new Set();
  ui.messages.innerHTML = '';

  const { data, error } = await state.supabase
    .from('mensajes')
    .select('id, room, user_id, username, contenido, created_at')
    .eq('room', state.room)
    .order('created_at', { ascending: true })
    .limit(60);

  if (error) {
    addSystemMessage('No se pudieron cargar los mensajes.');
    return;
  }

  if (!data || data.length === 0) {
    addSystemMessage('Aún no hay mensajes. Escribe el primero.');
    return;
  }

  for (const row of data) renderMessage(row);
  scrollMessagesToBottom();
}

function teardownRealtime() {
  if (!state.realtimeChannel) return;
  state.supabase.removeChannel(state.realtimeChannel);
  state.realtimeChannel = null;
}

function setupRealtime() {
  teardownRealtime();
  ui.roomStatus.textContent = 'Conectando…';

  state.realtimeChannel = state.supabase
    .channel(`mensajes:${state.room}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'mensajes', filter: `room=eq.${state.room}` },
      (payload) => renderMessage(payload.new),
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') ui.roomStatus.textContent = 'En tiempo real';
      if (status === 'CLOSED') ui.roomStatus.textContent = 'Desconectado';
      if (status === 'CHANNEL_ERROR') ui.roomStatus.textContent = 'Error realtime';
    });
}

async function enterApp() {
  showApp();
  ui.roomName.textContent = state.room === 'general' ? 'General' : state.room;
  ui.roomStatus.textContent = 'Cargando…';

  try {
    await loadProfile();
    await Promise.all([loadUsers(), loadMessages()]);
    setupRealtime();
  } catch (e) {
    showAuth();
    setHint(ui.authHint, e?.message || 'No se pudo iniciar sesión.', 'error');
  }
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
  return { data, email: cleanEmail, password: cleanPassword };
}

async function sendMessage(text) {
  const clean = String(text || '').trim();
  if (!clean) return;
  if (clean.length > 1000) throw new Error('Máximo 1000 caracteres.');
  if (!state.profile?.username) throw new Error('Perfil inválido.');

  ui.sendBtn.disabled = true;

  const payload = {
    room: state.room,
    user_id: state.session.user.id,
    username: state.profile.username,
    contenido: clean,
  };

  const { data, error } = await state.supabase.from('mensajes').insert(payload).select().single();
  ui.sendBtn.disabled = false;

  if (error) throw error;
  if (data) renderMessage(data);
}

function autosizeTextarea() {
  ui.msgInput.style.height = 'auto';
  ui.msgInput.style.height = `${Math.min(ui.msgInput.scrollHeight, 120)}px`;
}

function openSidebar() {
  ui.appRoot.classList.add('sidebar-open');
}

function closeSidebar() {
  ui.appRoot.classList.remove('sidebar-open');
}

function wireUi() {
  ui.tabLogin.addEventListener('click', () => switchTab('login'));
  ui.tabRegistro.addEventListener('click', () => switchTab('registro'));

  ui.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await signIn(ui.loginEmail.value, ui.loginPassword.value);
      setHint(ui.authHint, 'Entrando…', 'ok');
      await enterApp();
    } catch (err) {
      setHint(ui.authHint, err?.message || 'Login falló.', 'error');
    }
  });

  ui.signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.config?.enableSignup) return;
    try {
      const result = await signUp(ui.signupEmail.value, ui.signupPassword.value, ui.signupUsername.value);

      if (result.data?.session) {
        state.session = result.data.session;
        setHint(ui.signupHint, 'Cuenta creada. Entrando…', 'ok');
        await enterApp();
        return;
      }

      try {
        await signIn(result.email, result.password);
        setHint(ui.signupHint, 'Cuenta creada. Entrando…', 'ok');
        await enterApp();
      } catch {
        setHint(
          ui.signupHint,
          'Cuenta creada. Si tienes confirmación por email activada en Supabase, revisa tu correo y luego haz login.',
          'ok',
        );
        switchTab('login');
      }
    } catch (err) {
      setHint(ui.signupHint, err?.message || 'Registro falló.', 'error');
    }
  });

  ui.userSearch.addEventListener('input', () => renderUsers(state.users));

  ui.msgInput.addEventListener('input', autosizeTextarea);
  ui.msgInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    if (e.shiftKey) return;
    e.preventDefault();
    ui.sendForm.requestSubmit();
  });

  ui.sendForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await sendMessage(ui.msgInput.value);
      ui.msgInput.value = '';
      autosizeTextarea();
    } catch (err) {
      addSystemMessage(err?.message || 'No se pudo enviar.');
    }
  });

  ui.signOutBtn.addEventListener('click', async () => {
    await state.supabase.auth.signOut();
    showAuth();
  });

  ui.openSidebarBtn.addEventListener('click', openSidebar);
  ui.closeSidebarBtn.addEventListener('click', closeSidebar);

  document.addEventListener('click', (e) => {
    if (!ui.appRoot.classList.contains('sidebar-open')) return;
    const target = e.target;
    const clickedInsideSidebar = target instanceof Element && target.closest('#sidebar');
    const clickedButton = target instanceof Element && target.closest('#openSidebarBtn');
    if (!clickedInsideSidebar && !clickedButton) closeSidebar();
  });
}

async function init() {
  wireUi();
  switchTab('login');

  const res = await fetch('/api/config', { cache: 'no-store' });
  state.config = await res.json();

  if (!state.config?.supabaseUrl || !state.config?.supabaseAnonKey) {
    ui.loginBtn.disabled = true;
    setHint(
      ui.authHint,
      'Falta configurar SUPABASE_URL y SUPABASE_ANON_KEY en el servidor (/.env o variables de entorno).',
      'error',
    );
    ui.signupBtn.disabled = true;
    setHint(ui.signupHint, 'Registro desactivado (admin).', 'muted');
    return;
  }

  ui.signupBtn.disabled = !state.config.enableSignup;
  if (!state.config.enableSignup) setHint(ui.signupHint, 'Registro desactivado.', 'muted');

  state.supabase = createClient(state.config.supabaseUrl, state.config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const { data } = await state.supabase.auth.getSession();
  state.session = data.session;

  state.supabase.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    if (!session) showAuth();
  });

  if (state.session) {
    await enterApp();
  } else {
    showAuth();
  }
}

init();

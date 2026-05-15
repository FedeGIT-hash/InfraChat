import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const el = (id) => document.getElementById(id);

const ui = {
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
  sidebar: el('sidebar'),
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

function goToLogin() {
  window.location.assign('/login.html');
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
  throw new Error('Tu cuenta aún no tiene perfil en public.usuarios.');
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
  document.querySelector('.app').classList.add('sidebar-open');
}

function closeSidebar() {
  document.querySelector('.app').classList.remove('sidebar-open');
}

function wireUi() {
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
    goToLogin();
  });

  ui.openSidebarBtn.addEventListener('click', openSidebar);
  ui.closeSidebarBtn.addEventListener('click', closeSidebar);

  document.addEventListener('click', (e) => {
    const root = document.querySelector('.app');
    if (!root.classList.contains('sidebar-open')) return;
    const target = e.target;
    const clickedInsideSidebar = target instanceof Element && target.closest('#sidebar');
    const clickedButton = target instanceof Element && target.closest('#openSidebarBtn');
    if (!clickedInsideSidebar && !clickedButton) closeSidebar();
  });
}

async function init() {
  wireUi();

  let res;
  try {
    res = await fetch('/api/config', { cache: 'no-store' });
  } catch {
    addSystemMessage('No se pudo conectar con /api/config. Intenta recargar.');
    return;
  }

  if (!res.ok) {
    addSystemMessage(`Error /api/config (${res.status}).`);
    return;
  }

  try {
    state.config = await res.json();
  } catch {
    addSystemMessage('Respuesta inválida de /api/config.');
    return;
  }

  if (!state.config?.supabaseUrl || !state.config?.supabaseAnonKey) {
    addSystemMessage('Falta configurar SUPABASE_URL y SUPABASE_ANON_KEY en Vercel.');
    return;
  }

  state.supabase = createClient(state.config.supabaseUrl, state.config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const { data } = await state.supabase.auth.getSession();
  state.session = data.session;
  if (!state.session) {
    goToLogin();
    return;
  }

  state.supabase.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    if (!session) goToLogin();
  });

  ui.roomName.textContent = state.room === 'general' ? 'General' : state.room;
  ui.roomStatus.textContent = 'Cargando…';

  try {
    await loadProfile();
    await Promise.all([loadUsers(), loadMessages()]);
    setupRealtime();
    requestAnimationFrame(() => scrollMessagesToBottom());
  } catch (e) {
    teardownRealtime();
    await state.supabase.auth.signOut();
    goToLogin();
  }
}

init();

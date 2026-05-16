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
  activeChat: { type: 'general', peerId: null, peerUsername: null },
};

const fallbackConfig = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  enableSignup: true,
};

const notifier = {
  audio: null,
  enabled: true,
  unlocked: false,
  warnedMissing: false,
  lastPlayedAt: 0,
};

function goToLogin() {
  window.location.assign('/');
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

function makeDmRoom(a, b) {
  const id1 = String(a || '');
  const id2 = String(b || '');
  if (!id1 || !id2) return 'general';
  return id1 < id2 ? `dm_${id1}_${id2}` : `dm_${id2}_${id1}`;
}

function saveActiveChat() {
  try {
    const payload = {
      type: state.activeChat.type,
      peerId: state.activeChat.peerId,
      peerUsername: state.activeChat.peerUsername,
    };
    localStorage.setItem('infrachat_active_chat', JSON.stringify(payload));
  } catch {
    return;
  }
}

function loadActiveChat() {
  try {
    const raw = localStorage.getItem('infrachat_active_chat');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.type !== 'dm' && parsed.type !== 'general') return null;
    return {
      type: parsed.type,
      peerId: parsed.peerId || null,
      peerUsername: parsed.peerUsername || null,
    };
  } catch {
    return null;
  }
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

function initNotifier() {
  try {
    notifier.audio = new Audio('/noti.mp3');
    notifier.audio.preload = 'auto';
  } catch {
    notifier.audio = null;
  }

  const unlock = async () => {
    if (!notifier.audio || notifier.unlocked) return;
    try {
      await notifier.audio.play();
      notifier.audio.pause();
      notifier.audio.currentTime = 0;
      notifier.unlocked = true;
    } catch {
      notifier.unlocked = false;
    }
  };

  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
}

async function playNotification() {
  if (!notifier.enabled) return;
  if (!notifier.audio) return;
  if (!notifier.unlocked) return;

  const now = Date.now();
  if (now - notifier.lastPlayedAt < 700) return;
  notifier.lastPlayedAt = now;

  try {
    notifier.audio.currentTime = 0;
    await notifier.audio.play();
  } catch {
    if (!notifier.warnedMissing) {
      notifier.warnedMissing = true;
      addSystemMessage('Toca la pantalla para activar sonido de notificaciones.');
    }
  }
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
  const q = String(ui.userSearch.value || '').trim().toLowerCase();
  const filtered = users.filter((u) => {
    if (!q) return true;
    return String(u.username || '').toLowerCase().includes(q);
  });

  if (!q) {
    const general = document.createElement('div');
    general.className = `contact ${state.activeChat.type === 'general' ? 'active' : ''}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar online';
    avatar.textContent = 'G';

    const info = document.createElement('div');
    info.className = 'contact-info';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = 'General';

    const preview = document.createElement('div');
    preview.className = 'preview';
    preview.textContent = 'Sala general';

    info.appendChild(name);
    info.appendChild(preview);
    general.appendChild(avatar);
    general.appendChild(info);
    general.addEventListener('click', () => {
      setActiveChat({ type: 'general', peerId: null, peerUsername: null });
    });

    ui.usersList.appendChild(general);
  }

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
    const isPeer = state.activeChat.type === 'dm' && state.activeChat.peerId === u.id;
    row.className = `contact ${isPeer ? 'active' : ''}`;

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
    row.addEventListener('click', () => {
      if (!u.id || u.id === meId) return;
      setActiveChat({ type: 'dm', peerId: u.id, peerUsername: u.username || 'Usuario' });
    });
    ui.usersList.appendChild(row);
  }
}

async function setActiveChat(next) {
  const meId = state.session?.user?.id || null;
  if (next.type === 'dm') {
    if (!meId || !next.peerId) return;
    state.activeChat = {
      type: 'dm',
      peerId: next.peerId,
      peerUsername: next.peerUsername || 'Usuario',
    };
    state.room = makeDmRoom(meId, next.peerId);
    ui.roomName.textContent = state.activeChat.peerUsername || 'Chat';
  } else {
    state.activeChat = { type: 'general', peerId: null, peerUsername: null };
    state.room = 'general';
    ui.roomName.textContent = 'General';
  }

  saveActiveChat();
  renderUsers(state.users);
  closeSidebar();
  ui.roomStatus.textContent = 'Cargando…';
  teardownRealtime();
  await loadMessages();
  setupRealtime();
  requestAnimationFrame(() => scrollMessagesToBottom());
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
      async (payload) => {
        const row = payload.new;
        const isMine = state.session?.user?.id && row?.user_id === state.session.user.id;
        renderMessage(row);
        if (!isMine) await playNotification();
      },
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
  initNotifier();
  wireUi();

  let res = null;
  try {
    res = await fetch('/api/config', { cache: 'no-store' });
  } catch {
    res = null;
  }

  if (res && res.ok) {
    try {
      state.config = await res.json();
    } catch {
      state.config = null;
    }
  }

  if (!state.config?.supabaseUrl || !state.config?.supabaseAnonKey) {
    state.config = fallbackConfig;
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

  try {
    await loadProfile();
    await loadUsers();

    const restored = loadActiveChat();
    if (restored?.type === 'dm' && restored.peerId && restored.peerId !== state.session.user.id) {
      const found = state.users.find((u) => u.id === restored.peerId);
      await setActiveChat({
        type: 'dm',
        peerId: restored.peerId,
        peerUsername: found?.username || restored.peerUsername || 'Usuario',
      });
      return;
    }

    await setActiveChat({ type: 'general', peerId: null, peerUsername: null });
    requestAnimationFrame(() => scrollMessagesToBottom());
  } catch (e) {
    teardownRealtime();
    await state.supabase.auth.signOut();
    goToLogin();
  }
}

init();

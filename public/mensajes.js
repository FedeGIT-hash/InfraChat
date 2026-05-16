import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const el = (id) => document.getElementById(id);

const ui = {
  meLine: el('meLine'),
  roomAvatar: el('roomAvatar'),
  roomName: el('roomName'),
  roomStatus: el('roomStatus'),
  chatSubline: el('chatSubline'),
  messages: el('messages'),
  typingIndicator: el('typingIndicator'),
  sendForm: el('sendForm'),
  msgInput: el('msgInput'),
  sendBtn: el('sendBtn'),
  signOutBtn: el('signOutBtn'),
  callBtn: el('callBtn'),
  callOverlay: el('callOverlay'),
  callAvatar: el('callAvatar'),
  callTitle: el('callTitle'),
  callSub: el('callSub'),
  callAcceptBtn: el('callAcceptBtn'),
  callRejectBtn: el('callRejectBtn'),
  callHangBtn: el('callHangBtn'),
  callMuteBtn: el('callMuteBtn'),
  callHint: el('callHint'),
  remoteAudio: el('remoteAudio'),

  userSearch: el('userSearch'),
  searchUserBtn: el('searchUserBtn'),
  searchResult: el('searchResult'),
  requestsList: el('requestsList'),
  friendsList: el('friendsList'),

  profileBtn: el('profileBtn'),

  openSidebarBtn: el('openSidebarBtn'),
  closeSidebarBtn: el('closeSidebarBtn'),
  sidebar: el('sidebar'),
};

const state = {
  config: null,
  supabase: null,
  room: null,
  profile: null,
  session: null,
  friends: [],
  requests: [],
  searchUser: null,
  realtimeChannel: null,
  inboxChannel: null,
  socialChannel: null,
  callInboxChannel: null,
  socialRefreshTimer: null,
  seenMessageIds: new Set(),
  activeChat: { type: 'none', peerId: null, peerUsername: null, peerAvatarUrl: null, peerBio: null },
  typingUsers: {},
  unreadByRoom: {},
  incomingCallsByPeer: {},
  callIgnoreIds: {},
  call: {
    status: 'idle',
    id: null,
    peerId: null,
    peerUsername: null,
    peerAvatarUrl: null,
    direction: null,
    channel: null,
    pc: null,
    localStream: null,
    remoteStream: null,
    muted: false,
    pendingOffer: null,
    pendingRemoteCandidates: [],
  },
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
  audioCtx: null,
  gain: null,
  buffer: null,
  loading: false,
  ready: false,
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

function loadUnread() {
  try {
    const raw = localStorage.getItem('infrachat_unread');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveUnread() {
  try {
    localStorage.setItem('infrachat_unread', JSON.stringify(state.unreadByRoom || {}));
  } catch {
    return;
  }
}

function incUnread(room) {
  if (!room) return;
  if (!state.unreadByRoom) state.unreadByRoom = {};
  state.unreadByRoom[room] = (state.unreadByRoom[room] || 0) + 1;
  saveUnread();
}

function clearUnread(room) {
  if (!room) return;
  if (!state.unreadByRoom) state.unreadByRoom = {};
  if (!state.unreadByRoom[room]) return;
  delete state.unreadByRoom[room];
  saveUnread();
}

function getUnread(room) {
  return Number(state.unreadByRoom?.[room] || 0) || 0;
}

function parseDmOtherId(room, myId) {
  const r = String(room || '');
  if (!r.startsWith('dm_')) return null;
  const a = r.split('_')[1] || '';
  const b = r.split('_')[2] || '';
  if (!a || !b) return null;
  if (a === myId) return b;
  if (b === myId) return a;
  return null;
}

function showCallHint(text, tone = 'muted') {
  if (!ui.callHint) return;
  ui.callHint.textContent = text || '';
  if (!text) {
    ui.callHint.style.color = '';
    return;
  }
  if (tone === 'error') ui.callHint.style.color = 'rgba(255, 180, 180, 0.95)';
  if (tone === 'ok') ui.callHint.style.color = 'rgba(170, 255, 200, 0.95)';
  if (tone === 'muted') ui.callHint.style.color = '';
}

function setCallOverlayVisible(visible) {
  ui.callOverlay.classList.toggle('hidden', !visible);
}

function setCallUi(mode) {
  ui.callAcceptBtn.classList.add('hidden');
  ui.callRejectBtn.classList.add('hidden');
  ui.callHangBtn.classList.add('hidden');
  ui.callMuteBtn.classList.add('hidden');

  if (mode === 'incoming') {
    ui.callAcceptBtn.classList.remove('hidden');
    ui.callRejectBtn.classList.remove('hidden');
  }
  if (mode === 'outgoing') {
    ui.callHangBtn.classList.remove('hidden');
  }
  if (mode === 'in_call') {
    ui.callHangBtn.classList.remove('hidden');
    ui.callMuteBtn.classList.remove('hidden');
  }
}

async function sendBroadcast(channelName, event, payload, timeoutMs = 2200) {
  const ch = state.supabase.channel(channelName);
  let subscribed = false;
  const done = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    ch.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      if (subscribed) return;
      subscribed = true;
      clearTimeout(timer);
      resolve(true);
    });
  });

  const ok = await done;
  if (!ok) {
    state.supabase.removeChannel(ch);
    return false;
  }

  try {
    await ch.send({ type: 'broadcast', event, payload });
  } finally {
    state.supabase.removeChannel(ch);
  }
  return true;
}

function callChannelName(callId) {
  return `call:${callId}`;
}

function cleanupCallState() {
  if (state.call.pc) {
    try {
      state.call.pc.onicecandidate = null;
      state.call.pc.ontrack = null;
      state.call.pc.onconnectionstatechange = null;
      state.call.pc.close();
    } catch {
      return;
    }
  }

  if (state.call.channel) {
    state.supabase.removeChannel(state.call.channel);
  }

  if (state.call.localStream) {
    for (const t of state.call.localStream.getTracks()) t.stop();
  }

  state.call = {
    status: 'idle',
    id: null,
    peerId: null,
    peerUsername: null,
    peerAvatarUrl: null,
    direction: null,
    channel: null,
    pc: null,
    localStream: null,
    remoteStream: null,
    muted: false,
    pendingOffer: null,
    pendingRemoteCandidates: [],
  };

  setCallOverlayVisible(false);
  showCallHint('');
  if (ui.remoteAudio) ui.remoteAudio.srcObject = null;
  if (ui.callMuteBtn) ui.callMuteBtn.textContent = 'Silenciar';
}

function newCallId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {
    return `call_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  }
  return `call_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function setCallCard(peerUsername, peerAvatarUrl, title, sub) {
  setAvatar(ui.callAvatar, peerAvatarUrl, peerUsername);
  ui.callTitle.textContent = title || 'Llamada';
  ui.callSub.textContent = sub || '';
}

function isCallActive() {
  return state.call.status !== 'idle';
}

function rememberIgnoredCall(callId) {
  const id = String(callId || '').trim();
  if (!id) return;
  if (!state.callIgnoreIds) state.callIgnoreIds = {};
  state.callIgnoreIds[id] = Date.now();
}

function isIgnoredCall(callId) {
  const id = String(callId || '').trim();
  if (!id) return false;
  if (!state.callIgnoreIds) state.callIgnoreIds = {};
  const now = Date.now();
  for (const [k, v] of Object.entries(state.callIgnoreIds)) {
    if (!v || now - v > 60_000) delete state.callIgnoreIds[k];
  }
  return Boolean(state.callIgnoreIds[id]);
}

function rtcConfig() {
  return {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };
}

async function waitForIceGatheringComplete(pc, timeoutMs = 3200) {
  if (!pc) return;
  if (pc.iceGatheringState === 'complete') return;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        pc.removeEventListener('icegatheringstatechange', onChange);
      } catch {
        resolve();
        return;
      }
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    try {
      pc.addEventListener('icegatheringstatechange', onChange);
    } catch {
      resolve();
      return;
    }
    setTimeout(finish, timeoutMs);
  });
}

async function getLocalAudioStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Tu navegador no soporta llamadas (getUserMedia).');
  }
  const isLocalhost =
    location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '[::1]';
  if (!window.isSecureContext && !isLocalhost) {
    throw new Error('Para usar el micrófono necesitas abrir la web en HTTPS (o en http://localhost).');
  }
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
}

function describeMicError(err) {
  const name = String(err?.name || '').trim();
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Micrófono bloqueado. Actívalo en permisos del sitio (candado en la barra) y recarga.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No se encontró micrófono en el dispositivo.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'El micrófono está en uso por otra app. Ciérrala e intenta de nuevo.';
  }
  if (name === 'SecurityError') {
    return 'El navegador bloqueó el micrófono por no ser HTTPS (o por políticas del navegador).';
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return 'No se pudo iniciar el micrófono con la configuración actual.';
  }
  const msg = String(err?.message || '').trim();
  if (msg) return msg;
  return 'No se pudo usar el micrófono.';
}

async function primeRemoteAudio() {
  if (!ui.remoteAudio) return;
  try {
    const run = async () => {
      const wasMuted = ui.remoteAudio.muted;
      ui.remoteAudio.muted = true;
      await ui.remoteAudio.play();
      ui.remoteAudio.pause();
      ui.remoteAudio.muted = wasMuted;
    };
    await Promise.race([run(), new Promise((resolve) => setTimeout(resolve, 400))]);
  } catch {
    return;
  }
}

function wirePeerConnection(pc) {
  pc.ontrack = (ev) => {
    const stream = ev.streams?.[0];
    if (!stream) return;
    state.call.remoteStream = stream;
    if (ui.remoteAudio) ui.remoteAudio.srcObject = stream;
  };

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === 'connected') {
      state.call.status = 'in_call';
      setCallUi('in_call');
      showCallHint('En llamada', 'ok');
      return;
    }
    if (s === 'failed' || s === 'disconnected' || s === 'closed') {
      const peer = state.call.peerUsername || 'Usuario';
      cleanupCallState();
      addSystemMessage(`Llamada finalizada con ${peer}.`);
    }
  };
}

async function safeAddIceCandidate(pc, candidate) {
  if (!pc || !candidate) return;
  try {
    await pc.addIceCandidate(candidate);
  } catch {
    return;
  }
}

async function flushPendingCandidates() {
  const pc = state.call.pc;
  if (!pc) return;
  if (!pc.remoteDescription) return;
  const list = Array.isArray(state.call.pendingRemoteCandidates) ? state.call.pendingRemoteCandidates : [];
  state.call.pendingRemoteCandidates = [];
  for (const c of list) await safeAddIceCandidate(pc, c);
}

async function sendCallEvent(toId, event, payload) {
  if (!toId) return false;
  return sendBroadcast(`calls:${toId}`, event, payload);
}

async function hangupCall(shouldNotifyPeer = true) {
  const meId = state.session?.user?.id || null;
  const peerId = state.call.peerId;
  const callId = state.call.id;
  if (shouldNotifyPeer && meId && peerId && callId) {
    await sendCallEvent(peerId, 'call:hangup', { callId, fromId: meId, toId: peerId });
  }
  setIncomingBadge(peerId, false);
  cleanupCallState();
}

function setIncomingBadge(peerId, on) {
  if (!peerId) return;
  if (!state.incomingCallsByPeer) state.incomingCallsByPeer = {};
  if (on) state.incomingCallsByPeer[peerId] = true;
  else if (state.incomingCallsByPeer[peerId]) delete state.incomingCallsByPeer[peerId];
  renderFriends();
}

async function startOutgoingCall() {
  const meId = state.session?.user?.id || null;
  if (!meId) return;
  if (state.activeChat.type !== 'dm' || !state.activeChat.peerId) {
    addSystemMessage('Selecciona un amigo para llamar.');
    return;
  }
  if (isCallActive()) {
    addSystemMessage('Ya estás en una llamada.');
    return;
  }

  const peerId = state.activeChat.peerId;
  const friend = state.friends.find((f) => f.id === peerId) || null;
  if (!friend) {
    addSystemMessage('Solo puedes llamar a tus amigos.');
    return;
  }

  const callId = newCallId();
  if (state.callIgnoreIds?.[callId]) delete state.callIgnoreIds[callId];
  state.call.status = 'calling';
  state.call.id = callId;
  state.call.peerId = peerId;
  state.call.peerUsername = friend.username || 'Usuario';
  state.call.peerAvatarUrl = friend.avatar_url || '';
  state.call.direction = 'outgoing';
  state.call.pendingOffer = null;
  state.call.pendingRemoteCandidates = [];

  setCallOverlayVisible(true);
  setCallUi('outgoing');
  setCallCard(state.call.peerUsername, state.call.peerAvatarUrl, 'Llamando…', 'Pidiendo conexión al micrófono…');
  showCallHint('Permite el micrófono para iniciar la llamada.', 'muted');
  void primeRemoteAudio();

  let localStream = null;
  try {
    localStream = await getLocalAudioStream();
  } catch (e) {
    const m = describeMicError(e);
    showCallHint(m, 'error');
    addSystemMessage(m);
    await hangupCall(false);
    return;
  }

  const pc = new RTCPeerConnection(rtcConfig());
  state.call.pc = pc;
  state.call.localStream = localStream;
  wirePeerConnection(pc);
  for (const t of localStream.getTracks()) pc.addTrack(t, localStream);

  const gathered = [];
  pc.onicecandidate = (ev) => {
    if (ev.candidate) gathered.push(ev.candidate);
  };

  try {
    setCallCard(state.call.peerUsername, state.call.peerAvatarUrl, 'Llamando…', 'Creando oferta…');
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    setCallCard(state.call.peerUsername, state.call.peerAvatarUrl, 'Llamando…', 'Buscando ruta de conexión…');
    await waitForIceGatheringComplete(pc);

    const desc = pc.localDescription;
    if (!desc?.sdp) throw new Error('Oferta inválida.');

    const ok = await sendCallEvent(peerId, 'call:invite', {
      callId,
      fromId: meId,
      fromUsername: state.profile?.username || 'Usuario',
      fromAvatarUrl: state.profile?.avatar_url || '',
      toId: peerId,
      offer: { type: desc.type, sdp: desc.sdp },
      candidates: gathered,
    });

    if (!ok) {
      showCallHint('No se pudo enviar la llamada.', 'error');
      await hangupCall(false);
      return;
    }

    setCallCard(state.call.peerUsername, state.call.peerAvatarUrl, 'Llamando…', 'Esperando respuesta…');
    showCallHint('', 'muted');
  } catch (e) {
    showCallHint('No se pudo iniciar la llamada.', 'error');
    addSystemMessage(e?.message || 'No se pudo iniciar la llamada.');
    await hangupCall(false);
  }
}

async function acceptIncomingCall() {
  const meId = state.session?.user?.id || null;
  const callId = state.call.id;
  const peerId = state.call.peerId;
  const offer = state.call.pendingOffer;
  if (!meId || !callId || !peerId || !offer) return;
  if (state.call.status !== 'incoming') return;
  if (state.callIgnoreIds?.[callId]) delete state.callIgnoreIds[callId];

  state.call.status = 'connecting';
  setIncomingBadge(peerId, false);
  setCallUi('in_call');
  setCallCard(state.call.peerUsername, state.call.peerAvatarUrl, 'Conectando…', 'Pidiendo micrófono…');
  showCallHint('Permite el micrófono para contestar.', 'muted');
  void primeRemoteAudio();

  let localStream = null;
  try {
    localStream = await getLocalAudioStream();
  } catch (e) {
    const m = describeMicError(e);
    showCallHint(m, 'error');
    addSystemMessage(m);
    await sendCallEvent(peerId, 'call:reject', { callId, fromId: meId, toId: peerId, reason: 'mic_denied' });
    await hangupCall(false);
    return;
  }

  const pc = new RTCPeerConnection(rtcConfig());
  state.call.pc = pc;
  state.call.localStream = localStream;
  wirePeerConnection(pc);
  for (const t of localStream.getTracks()) pc.addTrack(t, localStream);

  const gathered = [];
  pc.onicecandidate = (ev) => {
    if (ev.candidate) gathered.push(ev.candidate);
  };

  try {
    await pc.setRemoteDescription(offer);
    await flushPendingCandidates();
    setCallCard(state.call.peerUsername, state.call.peerAvatarUrl, 'Conectando…', 'Creando respuesta…');
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    setCallCard(state.call.peerUsername, state.call.peerAvatarUrl, 'Conectando…', 'Buscando ruta de conexión…');
    await waitForIceGatheringComplete(pc);

    const desc = pc.localDescription;
    if (!desc?.sdp) throw new Error('Respuesta inválida.');

    await sendCallEvent(peerId, 'call:accept', {
      callId,
      fromId: meId,
      toId: peerId,
      answer: { type: desc.type, sdp: desc.sdp },
      candidates: gathered,
    });

    showCallHint('', 'muted');
  } catch (e) {
    showCallHint('No se pudo contestar.', 'error');
    addSystemMessage(e?.message || 'No se pudo contestar.');
    await sendCallEvent(peerId, 'call:reject', { callId, fromId: meId, toId: peerId, reason: 'error' });
    await hangupCall(false);
  }
}

async function rejectIncomingCall() {
  const meId = state.session?.user?.id || null;
  const callId = state.call.id;
  const peerId = state.call.peerId;
  if (!meId || !callId || !peerId) {
    cleanupCallState();
    return;
  }
  await sendCallEvent(peerId, 'call:reject', { callId, fromId: meId, toId: peerId, reason: 'rejected' });
  setIncomingBadge(peerId, false);
  cleanupCallState();
}

function toggleMute() {
  const stream = state.call.localStream;
  if (!stream) return;
  const tracks = stream.getAudioTracks();
  if (!tracks || tracks.length === 0) return;
  state.call.muted = !state.call.muted;
  for (const t of tracks) t.enabled = !state.call.muted;
  ui.callMuteBtn.textContent = state.call.muted ? 'Activar' : 'Silenciar';
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
    if (parsed.type !== 'dm') return null;
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

function setHint(target, text, tone = 'muted') {
  if (!target) return;
  target.textContent = text || '';
  if (!text) {
    target.style.color = '';
    return;
  }
  if (tone === 'error') target.style.color = 'rgba(255, 180, 180, 0.95)';
  if (tone === 'ok') target.style.color = 'rgba(170, 255, 200, 0.95)';
  if (tone === 'muted') target.style.color = '';
}

function setAvatar(target, avatarUrl, fallbackName) {
  if (!target) return;
  const url = String(avatarUrl || '').trim();
  if (url) {
    target.classList.add('has-img');
    target.style.backgroundImage = `url("${url}")`;
    target.textContent = firstLetter(fallbackName);
    return;
  }

  target.classList.remove('has-img');
  target.style.backgroundImage = '';
  target.textContent = firstLetter(fallbackName);
}

function setChatSubline(text) {
  const v = String(text || '').trim();
  if (!ui.chatSubline) return;
  if (!v) {
    ui.chatSubline.textContent = '';
    ui.chatSubline.classList.remove('show');
    return;
  }
  ui.chatSubline.textContent = v;
  requestAnimationFrame(() => ui.chatSubline.classList.add('show'));
}

function setNameWithBadge(target, name, verified) {
  if (!target) return;
  target.textContent = '';
  const text = document.createElement('span');
  text.textContent = name || '';
  target.appendChild(text);
  if (verified) {
    const badge = document.createElement('span');
    badge.className = 'verified-badge';
    badge.setAttribute('aria-label', 'Verificado');
    target.appendChild(badge);
  }
}

function setChatEnabled(enabled) {
  ui.msgInput.disabled = !enabled;
  ui.sendBtn.disabled = !enabled;
  if (!enabled) ui.msgInput.value = '';
}

function initNotifier() {
  try {
    notifier.audio = new Audio('/api/noti');
    notifier.audio.preload = 'auto';
    notifier.audio.volume = 0.9;
    notifier.audio.playsInline = true;
    notifier.audio.addEventListener('error', () => {
      const src = notifier.audio?.currentSrc || notifier.audio?.src || '';
      if (src.includes('/api/noti')) {
        notifier.audio.src = '/noti.mp3';
        notifier.audio.load();
      }
    });
  } catch {
    notifier.audio = null;
  }

  const unlock = async () => {
    if (notifier.unlocked) return;
    let ok = false;

    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        if (!notifier.audioCtx) {
          notifier.audioCtx = new Ctx();
          notifier.gain = notifier.audioCtx.createGain();
          notifier.gain.gain.value = 0.9;
          notifier.gain.connect(notifier.audioCtx.destination);
        }
        if (notifier.audioCtx.state !== 'running') await notifier.audioCtx.resume();

        const osc = notifier.audioCtx.createOscillator();
        const g = notifier.audioCtx.createGain();
        g.gain.value = 0;
        osc.connect(g);
        g.connect(notifier.audioCtx.destination);
        osc.start();
        osc.stop(notifier.audioCtx.currentTime + 0.01);
        ok = true;
      }
    } catch {
      ok = ok || false;
    }

    try {
      if (notifier.audio) {
        const prevMuted = notifier.audio.muted;
        notifier.audio.muted = true;
        await notifier.audio.play();
        notifier.audio.pause();
        notifier.audio.currentTime = 0;
        notifier.audio.muted = prevMuted;
        ok = true;
      }
    } catch {
      ok = ok || false;
    }

    notifier.unlocked = ok;
    if (ok) void preloadNotificationSound();
  };

  const onceOpts = { once: true, passive: true };
  document.addEventListener('touchstart', unlock, onceOpts);
  document.addEventListener('pointerdown', unlock, onceOpts);
  document.addEventListener('click', unlock, onceOpts);
  document.addEventListener('keydown', unlock, { once: true });

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (!notifier.audioCtx) return;
    try {
      if (notifier.audioCtx.state !== 'running') await notifier.audioCtx.resume();
    } catch {
      return;
    }
  });
}

async function playNotification() {
  if (!notifier.enabled) return;
  if (!notifier.unlocked) return;
  if (!notifier.audioCtx || !notifier.gain) {
    try {
      const src = notifier.audio?.currentSrc || notifier.audio?.src || '/api/noti';
      const a = new Audio(src);
      a.preload = 'auto';
      a.volume = 0.9;
      a.playsInline = true;
      await a.play();
      return;
    } catch {
      return;
    }
  }

  if (!notifier.ready) await preloadNotificationSound();
  if (!notifier.buffer) {
    try {
      const src = notifier.audio?.currentSrc || notifier.audio?.src || '/api/noti';
      const a = new Audio(src);
      a.preload = 'auto';
      a.volume = 0.9;
      a.playsInline = true;
      await a.play();
      return;
    } catch {
      return;
    }
  }

  const now = Date.now();
  if (now - notifier.lastPlayedAt < 700) return;
  notifier.lastPlayedAt = now;

  try {
    const source = notifier.audioCtx.createBufferSource();
    source.buffer = notifier.buffer;
    source.connect(notifier.gain);
    source.start(0);
  } catch {
    try {
      const src = notifier.audio?.currentSrc || notifier.audio?.src || '/api/noti';
      const a = new Audio(src);
      a.preload = 'auto';
      a.volume = 0.9;
      a.playsInline = true;
      await a.play();
    } catch {
      if (!notifier.warnedMissing) {
        notifier.warnedMissing = true;
        addSystemMessage('Toca la pantalla para activar sonido de notificaciones.');
      }
    }
  }
}

async function preloadNotificationSound() {
  if (notifier.loading || notifier.ready) return;
  if (!notifier.audioCtx) return;
  notifier.loading = true;

  const urls = ['/api/noti', '/noti.mp3'];
  let lastErr = null;

  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const buf = await res.arrayBuffer();
      notifier.buffer = await notifier.audioCtx.decodeAudioData(buf.slice(0));
      notifier.ready = true;
      notifier.loading = false;
      return;
    } catch (e) {
      lastErr = e;
    }
  }

  notifier.loading = false;
  notifier.ready = false;
  notifier.buffer = null;
  if (!notifier.warnedMissing) {
    notifier.warnedMissing = true;
    addSystemMessage('No se pudo cargar el audio de notificación (noti.mp3).');
  }
  void lastErr;
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

function isFriend(userId) {
  return state.friends.some((f) => f.id === userId);
}

function hasPendingWith(userId) {
  return state.requests.some((r) => r.user_id === userId && r.status === 'pending');
}

function renderEmpty(container, title, subtitle) {
  container.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'contact';
  const info = document.createElement('div');
  info.className = 'contact-info';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = title;
  const preview = document.createElement('div');
  preview.className = 'preview';
  preview.textContent = subtitle;
  info.appendChild(name);
  info.appendChild(preview);
  empty.appendChild(info);
  container.appendChild(empty);
}

function renderSearchResult() {
  const container = ui.searchResult;
  if (!container) return;

  const u = state.searchUser;
  if (!u) {
    renderEmpty(container, 'Busca por username', 'Escribe el username exacto y presiona buscar.');
    return;
  }

  container.innerHTML = '';

  const row = document.createElement('div');
  row.className = 'contact';

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  setAvatar(avatar, u.avatar_url, u.username);

  const info = document.createElement('div');
  info.className = 'contact-info';

  const name = document.createElement('div');
  name.className = 'name';
  setNameWithBadge(name, u.username, Boolean(u.verified));

  const preview = document.createElement('div');
  preview.className = 'preview';
  preview.textContent = u.bio ? u.bio : 'Usuario encontrado';

  info.appendChild(name);
  info.appendChild(preview);

  const actions = document.createElement('div');
  actions.className = 'contact-actions';

  const btn = document.createElement('button');
  btn.className = 'mini-btn';
  btn.type = 'button';

  if (isFriend(u.id)) {
    btn.textContent = 'Amigo';
    btn.disabled = true;
  } else if (hasPendingWith(u.id)) {
    btn.textContent = 'Enviado';
    btn.disabled = true;
  } else {
    btn.textContent = 'Agregar';
    btn.addEventListener('click', async () => {
      await enviarSolicitud(u.id);
    });
  }

  actions.appendChild(btn);

  row.appendChild(avatar);
  row.appendChild(info);
  row.appendChild(actions);

  container.appendChild(row);
}

function renderRequests() {
  const container = ui.requestsList;
  if (!container) return;

  const list = state.requests.filter((r) => r.status === 'pending');
  if (list.length === 0) {
    renderEmpty(container, 'Sin solicitudes', 'Cuando te envíen una, aparecerá aquí.');
    return;
  }

  container.innerHTML = '';

  for (const r of list) {
    const row = document.createElement('div');
    row.className = 'contact';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    setAvatar(avatar, r.avatar_url, r.username);

    const info = document.createElement('div');
    info.className = 'contact-info';

    const name = document.createElement('div');
    name.className = 'name';
    setNameWithBadge(name, r.username, Boolean(r.verified));

    const preview = document.createElement('div');
    preview.className = 'preview';
    preview.textContent = r.direction === 'in' ? 'Quiere agregarte' : 'Solicitud enviada';

    info.appendChild(name);
    info.appendChild(preview);

    const actions = document.createElement('div');
    actions.className = 'contact-actions';

    if (r.direction === 'in') {
      const ok = document.createElement('button');
      ok.className = 'mini-btn';
      ok.type = 'button';
      ok.textContent = 'Aceptar';
      ok.addEventListener('click', async (e) => {
        e.stopPropagation();
        ok.disabled = true;
        await aceptarSolicitud(r.id);
        ok.disabled = false;
      });

      const no = document.createElement('button');
      no.className = 'mini-btn danger';
      no.type = 'button';
      no.textContent = 'Rechazar';
      no.addEventListener('click', async (e) => {
        e.stopPropagation();
        no.disabled = true;
        await rechazarSolicitud(r.id);
        no.disabled = false;
      });

      actions.appendChild(ok);
      actions.appendChild(no);
    } else {
      const cancel = document.createElement('button');
      cancel.className = 'mini-btn danger';
      cancel.type = 'button';
      cancel.textContent = 'Cancelar';
      cancel.addEventListener('click', async (e) => {
        e.stopPropagation();
        cancel.disabled = true;
        await cancelarSolicitud(r.id);
        cancel.disabled = false;
      });
      actions.appendChild(cancel);
    }

    row.appendChild(avatar);
    row.appendChild(info);
    row.appendChild(actions);
    container.appendChild(row);
  }
}

function renderFriends() {
  const container = ui.friendsList;
  if (!container) return;

  if (!state.friends || state.friends.length === 0) {
    renderEmpty(container, 'Sin amigos', 'Agrega a alguien por username.');
    return;
  }

  container.innerHTML = '';

  const meId = state.session?.user?.id || null;

  for (const f of state.friends) {
    const row = document.createElement('div');
    const isActive = state.activeChat.type === 'dm' && state.activeChat.peerId === f.id;
    row.className = `contact ${isActive ? 'active' : ''}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    setAvatar(avatar, f.avatar_url, f.username);

    const info = document.createElement('div');
    info.className = 'contact-info';

    const name = document.createElement('div');
    name.className = 'name';
    setNameWithBadge(name, f.username, Boolean(f.verified));

    const preview = document.createElement('div');
    preview.className = 'preview';
    preview.textContent = f.bio ? f.bio : 'Amigo';

    info.appendChild(name);
    info.appendChild(preview);

    row.appendChild(avatar);
    row.appendChild(info);

    if (meId) {
      const room = makeDmRoom(meId, f.id);
      const unread = isActive ? 0 : getUnread(room);
      const isCalling = Boolean(state.incomingCallsByPeer?.[f.id]);
      if (unread > 0 || isCalling) {
        const actions = document.createElement('div');
        actions.className = 'contact-actions';

        if (isCalling) {
          const callBadge = document.createElement('div');
          callBadge.className = 'call-badge';
          callBadge.textContent = '📞';
          actions.appendChild(callBadge);
        }

        if (unread > 0) {
          const badge = document.createElement('div');
          badge.className = 'unread-badge';
          badge.textContent = unread > 99 ? '99+' : String(unread);
          actions.appendChild(badge);
        }

        row.appendChild(actions);
      }
    }

    row.addEventListener('click', async () => {
      await setActiveChat(f);
    });

    container.appendChild(row);
  }
}

async function setActiveChat(friend) {
  const meId = state.session?.user?.id || null;
  if (!meId || !friend?.id) return;

  state.activeChat = {
    type: 'dm',
    peerId: friend.id,
    peerUsername: friend.username || 'Usuario',
    peerAvatarUrl: friend.avatar_url || '',
    peerBio: friend.bio || '',
    peerVerified: Boolean(friend.verified),
  };

  state.room = makeDmRoom(meId, friend.id);
  clearUnread(state.room);
  setNameWithBadge(ui.roomName, state.activeChat.peerUsername, state.activeChat.peerVerified);
  ui.roomStatus.textContent = 'Conectado';
  setChatSubline(state.activeChat.peerBio);
  setAvatar(ui.roomAvatar, state.activeChat.peerAvatarUrl, state.activeChat.peerUsername);
  saveActiveChat();
  renderFriends();
  closeSidebar();
  setChatEnabled(true);

  ui.roomStatus.textContent = 'Cargando…';
  teardownRealtime();
  await loadMessages();
  setupRealtime();
  requestAnimationFrame(() => scrollMessagesToBottom());
}

async function loadFriends() {
  const { data, error } = await state.supabase.rpc('get_amigos');
  if (error) {
    console.error('loadFriends error', error);
    state.friends = [];
    return;
  }
  state.friends = Array.isArray(data) ? data : [];
}

async function loadRequests() {
  const { data, error } = await state.supabase.rpc('get_solicitudes');
  if (error) {
    console.error('loadRequests error', error);
    state.requests = [];
    return;
  }
  state.requests = Array.isArray(data) ? data : [];
}

async function buscarUsuarioExacto() {
  const q = String(ui.userSearch.value || '').trim();
  if (!q) {
    state.searchUser = null;
    renderSearchResult();
    return;
  }

  const { data, error } = await state.supabase.rpc('buscar_usuario', { p_username: q });
  if (error || !Array.isArray(data) || data.length === 0) {
    state.searchUser = null;
    renderSearchResult();
    return;
  }

  state.searchUser = data[0];
  renderSearchResult();
}

async function enviarSolicitud(targetId) {
  const fromId = state.session?.user?.id;
  if (!fromId) return;

  const { error } = await state.supabase
    .from('solicitudes_amistad')
    .insert({
      from_id: fromId,
      to_id: targetId,
      status: 'pending',
    })
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('enviarSolicitud error', error);
    addSystemMessage(error.message || 'No se pudo enviar la solicitud.');
    return;
  }
  await loadRequests();
  renderRequests();
  renderSearchResult();
  addSystemMessage('Solicitud enviada.');
}

async function aceptarSolicitud(id) {
  const { error } = await state.supabase.rpc('aceptar_solicitud', { solicitud_id: id });
  if (error) {
    console.error('aceptarSolicitud error', error);
    addSystemMessage(error.message || 'No se pudo aceptar.');
    return;
  }
  await Promise.all([loadFriends(), loadRequests()]);
  renderFriends();
  renderRequests();
  renderSearchResult();
  addSystemMessage('Solicitud aceptada.');
}

async function rechazarSolicitud(id) {
  const { error } = await state.supabase.rpc('rechazar_solicitud', { solicitud_id: id });
  if (error) {
    console.error('rechazarSolicitud error', error);
    addSystemMessage(error.message || 'No se pudo rechazar.');
    return;
  }
  await loadRequests();
  renderRequests();
  addSystemMessage('Solicitud rechazada.');
}

async function cancelarSolicitud(id) {
  const { error } = await state.supabase.rpc('cancelar_solicitud', { solicitud_id: id });
  if (error) {
    console.error('cancelarSolicitud error', error);
    addSystemMessage(error.message || 'No se pudo cancelar.');
    return;
  }
  await loadRequests();
  renderRequests();
  renderSearchResult();
  addSystemMessage('Solicitud cancelada.');
}

async function loadProfile() {
  const userId = state.session?.user?.id;
  if (!userId) throw new Error('Sesión inválida');

  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, error } = await state.supabase
      .from('usuarios')
      .select('id, username, avatar_url, bio, verified, is_admin')
      .eq('id', userId)
      .maybeSingle();

    if (!error && data) {
      state.profile = data;
      ui.meLine.textContent = `@${data.username}${data.verified ? ' ✓' : ''}`;
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
  ui.typingIndicator.classList.add('hidden');
  ui.typingIndicator.textContent = '';

  if (!state.room) {
    addSystemMessage('Busca a alguien por username, envía solicitud y espera a que acepte.');
    return;
  }

  clearUnread(state.room);
  renderFriends();

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
  state.typingUsers = {};
  renderTypingIndicator();
}

function teardownSocialRealtime() {
  if (!state.socialChannel) return;
  state.supabase.removeChannel(state.socialChannel);
  state.socialChannel = null;
  if (state.socialRefreshTimer) clearTimeout(state.socialRefreshTimer);
  state.socialRefreshTimer = null;
}

function teardownInboxRealtime() {
  if (!state.inboxChannel) return;
  state.supabase.removeChannel(state.inboxChannel);
  state.inboxChannel = null;
}

function teardownCallInboxRealtime() {
  if (!state.callInboxChannel) return;
  state.supabase.removeChannel(state.callInboxChannel);
  state.callInboxChannel = null;
}

function setupInboxRealtime() {
  teardownInboxRealtime();
  const uid = state.session?.user?.id || null;
  if (!uid) return;

  state.inboxChannel = state.supabase
    .channel(`inbox:${uid}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes' }, async (payload) => {
      const row = payload?.new;
      if (!row) return;
      if (row.user_id === uid) return;
      const room = String(row.room || '');
      if (!room.startsWith('dm_')) return;

      if (room === state.room) return;

      const otherId = parseDmOtherId(room, uid);
      if (!otherId) return;
      if (!state.friends.some((f) => f.id === otherId)) return;

      incUnread(room);
      renderFriends();
      await playNotification();
    })
    .subscribe();
}

function setupCallInboxRealtime() {
  teardownCallInboxRealtime();
  const uid = state.session?.user?.id || null;
  if (!uid) return;

  state.callInboxChannel = state.supabase
    .channel(`calls:${uid}`)
    .on('broadcast', { event: 'call:invite' }, async (payload) => {
      const p = payload?.payload || {};
      if (!p?.callId || !p?.fromId || !p?.toId) return;
      if (p.toId !== uid) return;
      if (isIgnoredCall(p.callId)) return;
      if (!state.friends.some((f) => f.id === p.fromId)) return;

      if (isCallActive()) {
        await sendCallEvent(p.fromId, 'call:reject', { callId: p.callId, fromId: uid, toId: p.fromId, reason: 'busy' });
        return;
      }

      state.call.status = 'incoming';
      state.call.id = p.callId;
      state.call.peerId = p.fromId;
      state.call.peerUsername = p.fromUsername || 'Usuario';
      state.call.peerAvatarUrl = p.fromAvatarUrl || '';
      state.call.direction = 'incoming';
      state.call.pc = null;
      state.call.localStream = null;
      state.call.remoteStream = null;
      state.call.muted = false;
      state.call.pendingOffer = p.offer || null;
      state.call.pendingRemoteCandidates = Array.isArray(p.candidates) ? p.candidates : [];

      setIncomingBadge(p.fromId, true);
      setCallOverlayVisible(true);
      setCallUi('incoming');
      setCallCard(state.call.peerUsername, state.call.peerAvatarUrl, 'Llamada entrante', `@${state.call.peerUsername}`);
      showCallHint('Toca Aceptar para contestar.', 'muted');
    })
    .on('broadcast', { event: 'call:accept' }, async (payload) => {
      const p = payload?.payload || {};
      const meId = uid;
      if (!p?.callId || !p?.fromId || !p?.toId) return;
      if (p.toId !== meId) return;
      if (state.call.status !== 'calling') return;
      if (p.callId !== state.call.id) return;
      if (p.fromId !== state.call.peerId) return;
      if (!state.call.pc) return;

      try {
        setCallCard(state.call.peerUsername, state.call.peerAvatarUrl, 'Conectando…', 'Aplicando respuesta…');
        await state.call.pc.setRemoteDescription(p.answer);
        if (Array.isArray(p.candidates) && p.candidates.length > 0) {
          state.call.pendingRemoteCandidates = [...(state.call.pendingRemoteCandidates || []), ...p.candidates];
        }
        await flushPendingCandidates();
        setCallUi('in_call');
        showCallHint('Conectando…', 'muted');
      } catch (e) {
        addSystemMessage(e?.message || 'No se pudo conectar la llamada.');
        await hangupCall(true);
      }
    })
    .on('broadcast', { event: 'call:reject' }, async (payload) => {
      const p = payload?.payload || {};
      const meId = uid;
      if (!p?.callId || !p?.fromId || !p?.toId) return;
      if (p.toId !== meId) return;
      rememberIgnoredCall(p.callId);
      if (!state.call.id || p.callId !== state.call.id) return;
      if (!state.call.peerId || p.fromId !== state.call.peerId) return;
      const peer = state.call.peerUsername || 'Usuario';
      setIncomingBadge(p.fromId, false);
      cleanupCallState();
      addSystemMessage(`Llamada rechazada por ${peer}.`);
      void p.reason;
    })
    .on('broadcast', { event: 'call:hangup' }, async (payload) => {
      const p = payload?.payload || {};
      const meId = uid;
      if (!p?.callId || !p?.fromId || !p?.toId) return;
      if (p.toId !== meId) return;
      rememberIgnoredCall(p.callId);
      if (!state.call.id || p.callId !== state.call.id) return;
      if (!state.call.peerId || p.fromId !== state.call.peerId) return;
      const peer = state.call.peerUsername || 'Usuario';
      setIncomingBadge(p.fromId, false);
      cleanupCallState();
      addSystemMessage(`Llamada finalizada con ${peer}.`);
    })
    .on('broadcast', { event: 'call:ice' }, async (payload) => {
      const p = payload?.payload || {};
      const meId = uid;
      if (!p?.callId || !p?.fromId || !p?.toId) return;
      if (p.toId !== meId) return;
      if (!state.call.id || p.callId !== state.call.id) return;
      if (!state.call.peerId || p.fromId !== state.call.peerId) return;
      if (!state.call.pc) return;
      if (!p.candidate) return;
      if (!state.call.pendingRemoteCandidates) state.call.pendingRemoteCandidates = [];
      if (!state.call.pc.remoteDescription) {
        state.call.pendingRemoteCandidates.push(p.candidate);
        return;
      }
      await safeAddIceCandidate(state.call.pc, p.candidate);
    })
    .subscribe();
}

function scheduleSocialRefresh() {
  if (state.socialRefreshTimer) return;
  state.socialRefreshTimer = setTimeout(async () => {
    state.socialRefreshTimer = null;
    await Promise.all([loadFriends(), loadRequests()]);
    renderFriends();
    renderRequests();
    renderSearchResult();
  }, 220);
}

function setupSocialRealtime() {
  teardownSocialRealtime();
  const uid = state.session?.user?.id || null;
  if (!uid) return;

  state.socialChannel = state.supabase
    .channel(`social:${uid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes_amistad', filter: `to_id=eq.${uid}` }, () => {
      scheduleSocialRefresh();
    })
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'solicitudes_amistad', filter: `from_id=eq.${uid}` },
      () => {
        scheduleSocialRefresh();
      },
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'amistades', filter: `user1=eq.${uid}` }, () => {
      scheduleSocialRefresh();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'amistades', filter: `user2=eq.${uid}` }, () => {
      scheduleSocialRefresh();
    })
    .subscribe();
}

function setupRealtime() {
  teardownRealtime();
  if (!state.room) return;
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
    .on('broadcast', { event: 'typing' }, (payload) => {
      const meId = state.session?.user?.id || null;
      const p = payload?.payload || {};
      if (!p || !p.userId || p.userId === meId) return;
      if (p.room !== state.room) return;

      if (!state.typingUsers) state.typingUsers = {};
      if (p.isTyping) {
        state.typingUsers[p.userId] = { username: p.username || 'Usuario', lastAt: Date.now() };
      } else if (state.typingUsers[p.userId]) {
        delete state.typingUsers[p.userId];
      }
      renderTypingIndicator();
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') ui.roomStatus.textContent = 'En tiempo real';
      if (status === 'CLOSED') ui.roomStatus.textContent = 'Desconectado';
      if (status === 'CHANNEL_ERROR') ui.roomStatus.textContent = 'Error realtime';
    });
}

function renderTypingIndicator() {
  const typing = state.typingUsers || {};
  const now = Date.now();
  for (const [k, v] of Object.entries(typing)) {
    if (!v?.lastAt || now - v.lastAt > 3500) delete typing[k];
  }

  const names = Object.values(typing)
    .map((x) => x.username)
    .filter(Boolean);

  if (names.length === 0) {
    ui.typingIndicator.classList.add('hidden');
    ui.typingIndicator.textContent = '';
    return;
  }

  const label = names.length === 1 ? `${names[0]} está escribiendo…` : `${names.length} están escribiendo…`;
  ui.typingIndicator.textContent = label;
  ui.typingIndicator.classList.remove('hidden');
}

function broadcastTyping(isTyping) {
  const meId = state.session?.user?.id || null;
  if (!meId || !state.realtimeChannel) return;
  state.realtimeChannel.send({
    type: 'broadcast',
    event: 'typing',
    payload: {
      room: state.room,
      userId: meId,
      username: state.profile?.username || 'Usuario',
      isTyping: Boolean(isTyping),
    },
  });
}

function createTypingController() {
  let lastSent = null;
  let offTimer = null;

  return {
    onInput() {
      const hasText = String(ui.msgInput.value || '').trim().length > 0;
      const should = hasText;

      if (should !== lastSent) {
        lastSent = should;
        broadcastTyping(should);
      }

      if (offTimer) clearTimeout(offTimer);
      offTimer = setTimeout(() => {
        if (lastSent) {
          lastSent = false;
          broadcastTyping(false);
        }
      }, 1200);
    },
    forceOff() {
      if (offTimer) clearTimeout(offTimer);
      offTimer = null;
      if (lastSent) {
        lastSent = false;
        broadcastTyping(false);
      }
    },
  };
}

const typingCtl = createTypingController();

async function sendMessage(text) {
  const clean = String(text || '').trim();
  if (!clean) return;
  if (clean.length > 1000) throw new Error('Máximo 1000 caracteres.');
  if (!state.profile?.username) throw new Error('Perfil inválido.');
  if (!state.room || state.activeChat.type !== 'dm') throw new Error('Selecciona un amigo para chatear.');

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
  ui.searchUserBtn.addEventListener('click', async () => {
    await buscarUsuarioExacto();
  });
  ui.userSearch.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    await buscarUsuarioExacto();
  });
  ui.userSearch.addEventListener('input', () => {
    if (String(ui.userSearch.value || '').trim().length === 0) {
      state.searchUser = null;
      renderSearchResult();
    }
  });

  ui.msgInput.addEventListener('input', () => {
    autosizeTextarea();
    typingCtl.onInput();
  });
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
      typingCtl.forceOff();
    } catch (err) {
      addSystemMessage(err?.message || 'No se pudo enviar.');
    }
  });

  ui.signOutBtn.addEventListener('click', async () => {
    await state.supabase.auth.signOut();
    goToLogin();
  });

  ui.callBtn.addEventListener('click', async () => {
    await startOutgoingCall();
  });
  ui.callAcceptBtn.addEventListener('click', async () => {
    await acceptIncomingCall();
  });
  ui.callRejectBtn.addEventListener('click', async () => {
    await rejectIncomingCall();
  });
  ui.callHangBtn.addEventListener('click', async () => {
    await hangupCall(true);
  });
  ui.callMuteBtn.addEventListener('click', () => {
    toggleMute();
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

  state.unreadByRoom = loadUnread();

  setupSocialRealtime();
  setupInboxRealtime();
  setupCallInboxRealtime();

  state.supabase.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    if (!session) {
      teardownSocialRealtime();
      teardownInboxRealtime();
      teardownRealtime();
      teardownCallInboxRealtime();
      cleanupCallState();
      goToLogin();
      return;
    }
    setupSocialRealtime();
    setupInboxRealtime();
    setupCallInboxRealtime();
  });

  try {
    await loadProfile();
    await Promise.all([loadFriends(), loadRequests()]);
    renderSearchResult();
    renderRequests();
    renderFriends();

    const restored = loadActiveChat();
    const restoredFriend =
      restored?.type === 'dm' && restored.peerId ? state.friends.find((f) => f.id === restored.peerId) : null;

    if (restoredFriend) {
      await setActiveChat(restoredFriend);
      return;
    }

    if (state.friends.length > 0) {
      await setActiveChat(state.friends[0]);
      return;
    }

    state.room = null;
    state.activeChat = { type: 'none', peerId: null, peerUsername: null, peerAvatarUrl: null, peerBio: null };
    ui.roomName.textContent = 'InfraChat';
    ui.roomStatus.textContent = 'Agrega amigos para chatear';
    setChatSubline('');
    setAvatar(ui.roomAvatar, '', 'I');
    setChatEnabled(false);
    teardownRealtime();
    await loadMessages();
  } catch (e) {
    teardownRealtime();
    await state.supabase.auth.signOut();
    goToLogin();
  }
}

init();

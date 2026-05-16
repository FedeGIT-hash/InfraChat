import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const el = (id) => document.getElementById(id);

const ui = {
  signOutBtn: el('signOutBtn'),
  coverBox: el('coverBox'),
  coverInput: el('coverInput'),
  uploadCoverBtn: el('uploadCoverBtn'),
  avatarBox: el('avatarBox'),
  avatarInput: el('avatarInput'),
  uploadAvatarBtn: el('uploadAvatarBtn'),
  usernameLine: el('usernameLine'),
  verifiedBadge: el('verifiedBadge'),
  bioInput: el('bioInput'),
  saveProfileBtn: el('saveProfileBtn'),
  profileHint: el('profileHint'),

  adminCard: el('adminCard'),
  adminCreateUserForm: el('adminCreateUserForm'),
  adminEmail: el('adminEmail'),
  adminUsername: el('adminUsername'),
  adminPassword: el('adminPassword'),
  adminCreateBtn: el('adminCreateBtn'),
  adminHint: el('adminHint'),
};

const state = {
  config: null,
  supabase: null,
  session: null,
  profile: null,
};

const fallbackConfig = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  enableSignup: true,
};

function setHint(text, tone = 'muted') {
  ui.profileHint.textContent = text || '';
  if (!text) {
    ui.profileHint.style.color = '';
    return;
  }
  if (tone === 'error') ui.profileHint.style.color = 'rgba(255, 180, 180, 0.95)';
  if (tone === 'ok') ui.profileHint.style.color = 'rgba(170, 255, 200, 0.95)';
  if (tone === 'muted') ui.profileHint.style.color = '';
}

function firstLetter(name) {
  const v = String(name || '').trim();
  return v ? v[0].toUpperCase() : '?';
}

function setAvatar(avatarUrl, fallbackName) {
  const url = String(avatarUrl || '').trim();
  if (url) {
    ui.avatarBox.classList.add('has-img');
    ui.avatarBox.style.backgroundImage = `url("${url}")`;
    ui.avatarBox.textContent = firstLetter(fallbackName);
    return;
  }
  ui.avatarBox.classList.remove('has-img');
  ui.avatarBox.style.backgroundImage = '';
  ui.avatarBox.textContent = firstLetter(fallbackName);
}

function setCover(coverUrl) {
  const url = String(coverUrl || '').trim();
  if (url) {
    ui.coverBox.classList.add('has-img');
    ui.coverBox.style.backgroundImage = `url("${url}")`;
    return;
  }
  ui.coverBox.classList.remove('has-img');
  ui.coverBox.style.backgroundImage = '';
}

function goToLogin() {
  window.location.assign('/');
}

async function loadConfig() {
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
    setHint('Falta configurar SUPABASE_URL y SUPABASE_ANON_KEY en Vercel.', 'error');
    throw new Error('Missing config');
  }
}

async function loadProfile() {
  const userId = state.session?.user?.id;
  if (!userId) throw new Error('Sesión inválida');

  const { data, error } = await state.supabase
    .from('usuarios')
    .select('id, username, avatar_url, cover_url, bio, verified, is_admin')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) throw error || new Error('No profile');
  state.profile = data;

  ui.usernameLine.textContent = `@${data.username}`;
  ui.verifiedBadge.classList.toggle('hidden', !data.verified);
  ui.bioInput.value = data.bio || '';
  setAvatar(data.avatar_url, data.username);
  setCover(data.cover_url);

  ui.adminCard.classList.toggle('hidden', !data.is_admin);
}

async function canvasToJpegBlob(canvas, quality = 0.86) {
  const blob = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
  });
  if (!blob) throw new Error('No se pudo procesar la imagen.');
  return blob;
}

async function resizeToSquare(file, size = 256) {
  const bitmap = await createImageBitmap(file);
  const min = Math.min(bitmap.width, bitmap.height);
  const sx = Math.max(0, Math.floor((bitmap.width - min) / 2));
  const sy = Math.max(0, Math.floor((bitmap.height - min) / 2));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, min, min, 0, 0, size, size);
  return canvasToJpegBlob(canvas);
}

async function resizeToCover(file, w = 1200, h = 420) {
  const bitmap = await createImageBitmap(file);
  const srcRatio = bitmap.width / bitmap.height;
  const dstRatio = w / h;

  let sw = bitmap.width;
  let sh = bitmap.height;
  let sx = 0;
  let sy = 0;

  if (srcRatio > dstRatio) {
    sw = Math.floor(bitmap.height * dstRatio);
    sx = Math.floor((bitmap.width - sw) / 2);
  } else {
    sh = Math.floor(bitmap.width / dstRatio);
    sy = Math.floor((bitmap.height - sh) / 2);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
  return canvasToJpegBlob(canvas, 0.84);
}

async function uploadImage(path, blob) {
  const fileName = String(path || '').split('/').pop() || 'image.jpg';
  const file =
    blob instanceof File ? blob : new File([blob], fileName, { type: 'image/jpeg', lastModified: Date.now() });

  const { error } = await state.supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
  if (error) throw error;

  const { data } = state.supabase.storage.from('avatars').getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

async function uploadAvatar() {
  const userId = state.session?.user?.id;
  if (!userId) return;

  const file = ui.avatarInput.files?.[0] || null;
  if (!file) {
    setHint('Selecciona una imagen.', 'muted');
    return;
  }

  ui.uploadAvatarBtn.disabled = true;
  setHint('Subiendo foto…', 'muted');
  try {
    const blob = await resizeToSquare(file, 256);
    const url = await uploadImage(`${userId}/avatar.jpg`, blob);
    const { error } = await state.supabase.from('usuarios').update({ avatar_url: url }).eq('id', userId);
    if (error) throw error;
    state.profile.avatar_url = url;
    setAvatar(url, state.profile.username);
    setHint('Foto actualizada.', 'ok');
  } catch (err) {
    const detail = err?.message ? ` (${err.message})` : '';
    setHint(`No se pudo subir la foto. Revisa bucket/policies.${detail}`, 'error');
  } finally {
    ui.uploadAvatarBtn.disabled = false;
  }
}

async function uploadCover() {
  const userId = state.session?.user?.id;
  if (!userId) return;

  const file = ui.coverInput.files?.[0] || null;
  if (!file) {
    setHint('Selecciona una imagen.', 'muted');
    return;
  }

  ui.uploadCoverBtn.disabled = true;
  setHint('Subiendo portada…', 'muted');
  try {
    const blob = await resizeToCover(file);
    const url = await uploadImage(`${userId}/cover.jpg`, blob);
    const { error } = await state.supabase.from('usuarios').update({ cover_url: url }).eq('id', userId);
    if (error) throw error;
    state.profile.cover_url = url;
    setCover(url);
    setHint('Portada actualizada.', 'ok');
  } catch (err) {
    const detail = err?.message ? ` (${err.message})` : '';
    setHint(`No se pudo subir la portada. Revisa bucket/policies.${detail}`, 'error');
  } finally {
    ui.uploadCoverBtn.disabled = false;
  }
}

async function saveProfile() {
  const userId = state.session?.user?.id;
  if (!userId) return;

  const bio = String(ui.bioInput.value || '').trim();
  ui.saveProfileBtn.disabled = true;
  setHint('Guardando…', 'muted');
  try {
    const { error } = await state.supabase.from('usuarios').update({ bio }).eq('id', userId);
    if (error) throw error;
    state.profile.bio = bio;
    setHint('Guardado.', 'ok');
  } catch {
    setHint('No se pudo guardar.', 'error');
  } finally {
    ui.saveProfileBtn.disabled = false;
  }
}

function setAdminHint(text, tone = 'muted') {
  ui.adminHint.textContent = text || '';
  if (!text) {
    ui.adminHint.style.color = '';
    return;
  }
  if (tone === 'error') ui.adminHint.style.color = 'rgba(255, 180, 180, 0.95)';
  if (tone === 'ok') ui.adminHint.style.color = 'rgba(170, 255, 200, 0.95)';
  if (tone === 'muted') ui.adminHint.style.color = '';
}

async function adminCreateUser(email, username, password) {
  const token = state.session?.access_token || '';
  if (!token) throw new Error('Sesión inválida');

  const res = await fetch('/api/admin/create-user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ email, username, password: password || null }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error || `Error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function wireUi() {
  ui.signOutBtn.addEventListener('click', async () => {
    await state.supabase.auth.signOut();
    goToLogin();
  });

  ui.uploadAvatarBtn.addEventListener('click', uploadAvatar);
  ui.uploadCoverBtn.addEventListener('click', uploadCover);
  ui.saveProfileBtn.addEventListener('click', saveProfile);

  ui.adminCreateUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setAdminHint('');
    ui.adminCreateBtn.disabled = true;

    const email = String(ui.adminEmail.value || '').trim();
    const username = String(ui.adminUsername.value || '').trim();
    const password = String(ui.adminPassword.value || '').trim();

    try {
      const out = await adminCreateUser(email, username, password);
      ui.adminEmail.value = '';
      ui.adminUsername.value = '';
      ui.adminPassword.value = '';
      const shownPass = out.password ? ` Contraseña: ${out.password}` : '';
      setAdminHint(`Creado: ${out.email}.${shownPass}`, 'ok');
    } catch (err) {
      setAdminHint(err?.message || 'No se pudo crear.', 'error');
    } finally {
      ui.adminCreateBtn.disabled = false;
    }
  });
}

async function init() {
  await loadConfig();
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

  wireUi();
  await loadProfile();
}

init();

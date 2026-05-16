const { createClient } = require('@supabase/supabase-js');

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function generatePassword(length = 14) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_';
  let out = '';
  for (let i = 0; i < length; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || '';
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    json(res, 500, { error: 'Server not configured' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    json(res, 401, { error: 'Missing auth token' });
    return;
  }

  let body = null;
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  } catch {
    body = null;
  }

  const email = String(body?.email || '').trim();
  const username = String(body?.username || '').trim();
  const password = String(body?.password || '').trim() || generatePassword();

  if (!email || !email.includes('@')) {
    json(res, 400, { error: 'Email inválido' });
    return;
  }
  if (!username || username.length < 2 || username.length > 24) {
    json(res, 400, { error: 'Username inválido' });
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authData?.user?.id) {
    json(res, 401, { error: 'Token inválido' });
    return;
  }

  const requesterId = authData.user.id;
  const { data: adminRow, error: adminErr } = await supabase
    .from('usuarios')
    .select('id, is_admin')
    .eq('id', requesterId)
    .maybeSingle();

  if (adminErr || !adminRow?.is_admin) {
    json(res, 403, { error: 'No autorizado' });
    return;
  }

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username },
  });

  if (createErr || !created?.user?.id) {
    json(res, 400, { error: createErr?.message || 'No se pudo crear' });
    return;
  }

  json(res, 200, { id: created.user.id, email: created.user.email, username, password });
};


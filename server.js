const path = require('node:path');

const dotenv = require('dotenv');
const express = require('express');

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const ENABLE_SIGNUP = String(process.env.ENABLE_SIGNUP || '').toLowerCase() === 'true';

app.disable('x-powered-by');

function sendConfig(_req, res) {
  res.json({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    enableSignup: ENABLE_SIGNUP,
  });
}

app.get('/config', sendConfig);
app.get('/api/config', sendConfig);
app.get('/noti.mp3', (_req, res) => {
  res.sendFile(path.resolve(__dirname, 'noti.mp3'));
});

app.use(express.static(path.resolve(__dirname, 'public')));

app.get('*', (_req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    process.stdout.write(`InfraChat running on http://localhost:${PORT}\n`);
  });
}

module.exports = app;
module.exports.app = app;
module.exports.default = app;

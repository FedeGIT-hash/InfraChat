const fs = require('node:fs');
const path = require('node:path');

module.exports = function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const candidates = [
    path.resolve(process.cwd(), 'public', 'noti.mp3'),
    path.resolve(process.cwd(), 'noti.mp3'),
  ];

  const filePath = candidates.find((p) => fs.existsSync(p)) || '';
  if (!filePath) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'noti.mp3 not found' }));
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'stream error' }));
  });
  stream.pipe(res);
};

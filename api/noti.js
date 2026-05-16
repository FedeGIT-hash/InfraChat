const fs = require('node:fs');
const path = require('node:path');

module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const filePath = path.resolve(process.cwd(), 'noti.mp3');
  if (!fs.existsSync(filePath)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'noti.mp3 not found' }));
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'stream error' }));
  });
  stream.pipe(res);
};


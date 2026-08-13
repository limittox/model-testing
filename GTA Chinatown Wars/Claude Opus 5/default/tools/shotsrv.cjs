/* Dev-only screenshot sink.
   The game POSTs a data-url here and it lands in tools/shots/<name>.jpg,
   which is how the renderer gets eyeballed while iterating. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'shots');
fs.mkdirSync(DIR, { recursive: true });

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(200); res.end('shotsrv up'); return; }

  const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'frame')
    .replace(/[^a-z0-9_-]/gi, '_');
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const m = /^data:image\/(\w+);base64,(.*)$/s.exec(body);
    if (!m) { res.writeHead(400); res.end('bad payload'); return; }
    const file = path.join(DIR, name + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]));
    fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
    res.writeHead(200);
    res.end(file + ' ' + fs.statSync(file).size);
  });
}).listen(8093, () => console.log('shotsrv listening on 8093'));

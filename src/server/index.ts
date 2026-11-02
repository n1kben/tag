import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname, normalize } from 'path';
import { fileURLToPath } from 'url';
import { createRoom, joinRoom, findRoom, leaveRoom } from './room';
import { rtcStart, rtcSignal, rtcClose } from './rtc';
import { decodeInputs } from '../shared/wire';
import type { ClientMessage } from '../shared/protocol';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const isDev = process.env.NODE_ENV !== 'production';
const PORT = Number(process.env.PORT) || (isDev ? 3001 : 8080);
const DIST_DIR = join(__dirname, '..');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
};

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  if (isDev) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Rooftop Fu server (dev) — open the Vite URL');
    return;
  }
  const urlPath = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(DIST_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(DIST_DIR) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(DIST_DIR, 'index.html');
  }
  try {
    const type = MIME_TYPES[extname(filePath)] || 'application/octet-stream';
    const body = readFileSync(filePath);
    // Safari won't stream <audio> without byte ranges
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? +range[1] : Math.max(0, body.length - +range[2]);
      const end = range[1] && range[2] ? Math.min(+range[2], body.length - 1) : body.length - 1;
      if (start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${body.length}` });
        res.end();
        return;
      }
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${body.length}` });
      res.end(body.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = createServer(serveStatic);
const wss = new WebSocketServer({ server, maxPayload: 4096 });

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (data: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    try {
      dispatch(ws, msg);
    } catch (err) {
      console.error('bad message', err); // one client must never take the server down
    }
  });
  // Oversized/garbled frames emit 'error'; unhandled, that would kill the whole process
  ws.on('error', () => ws.terminate());
  ws.on('close', () => { rtcClose(ws); leaveRoom(ws); });
});

function dispatch(ws: WebSocket, msg: ClientMessage): void {
  switch (msg.type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
      break;
    case 'create_room':
      leaveRoom(ws);
      createRoom(ws, !!msg.practice, msg.mode === 'dm' ? 'dm' : 'tag', Number(msg.bots) || 0);
      break;
    case 'join_room':
      leaveRoom(ws);
      if (!joinRoom(ws, String(msg.roomId))) {
        ws.send(JSON.stringify({ type: 'error', msg: 'Room not found or full' }));
      }
      break;
    case 'leave':
      leaveRoom(ws);
      break;
    case 'rtc_start':
      // Inputs over UDP arrive as packets of the last few; each goes the same way a WebSocket input does
      rtcStart(ws, m => ws.send(JSON.stringify(m)), data => {
        for (const i of decodeInputs(data)) findRoom(ws)?.handle(ws, { type: 'input', ...i });
      });
      break;
    case 'rtc_answer':
    case 'rtc_ice':
      rtcSignal(ws, msg);
      break;
    default:
      findRoom(ws)?.handle(ws, msg);
  }
}

// HOST=127.0.0.1 keeps it off the network when a tunnel (Tailscale Funnel) fronts it;
// unset = all interfaces (dev: Vite's proxy may connect over IPv6 localhost)
const HOST = process.env.HOST || undefined;
server.listen(PORT, HOST, () => {
  console.log(`Rooftop Fu server listening on ${HOST ?? '*'}:${PORT}`);
});

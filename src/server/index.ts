import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createRoom, joinRoom, removeFromRoom, findRoomByWs } from './room';
import type { ClientMessage } from '../shared/protocol';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const isDev = process.env.NODE_ENV !== 'production';
const PORT = isDev ? 3001 : 8080;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
};

const DIST_DIR = join(__dirname, '..');

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  if (isDev) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Tag Game Server (dev)');
    return;
  }

  let filePath = join(DIST_DIR, req.url === '/' ? 'index.html' : req.url!);
  if (!existsSync(filePath)) {
    filePath = join(DIST_DIR, 'index.html');
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = createServer(serveStatic);

const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected');

  ws.on('message', (data: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'create_room': {
        const room = createRoom(ws);
        console.log(`Room ${room.id} created`);
        break;
      }
      case 'join_room': {
        const room = joinRoom(ws, msg.roomId);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', msg: 'Room not found or full' }));
        } else {
          console.log(`Player joined room ${room.id}`);
        }
        break;
      }
      case 'input':
      case 'rename':
      case 'ready': {
        const room = findRoomByWs(ws);
        if (room) room.handleMessage(ws, msg);
        break;
      }
      case 'leave': {
        removeFromRoom(ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    removeFromRoom(ws);
  });
});

server.listen(PORT, () => {
  console.log(`Tag game server listening on port ${PORT}`);
});

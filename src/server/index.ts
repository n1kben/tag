import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createRoom, joinRoom, removeFromRoom, findRoomByWs } from './room';
import { initDB } from './db';
import type { ClientMessage } from '../shared/protocol';

const PORT = 3001;

initDB();

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Tag Game Server');
});

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
        const room = createRoom(ws, msg.name);
        console.log(`Room ${room.id} created by ${msg.name}`);
        break;
      }
      case 'join_room': {
        const room = joinRoom(ws, msg.roomId, msg.name);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', msg: 'Room not found or full' }));
        } else {
          console.log(`${msg.name} joined room ${room.id}`);
        }
        break;
      }
      case 'input': {
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

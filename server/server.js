// Serves the static AllInBots site and a /ws WebSocket endpoint for online
// multiplayer rooms. Run with `node server.js` (after `npm install` in this
// folder); it needs a real, persistently-running host — static hosting alone
// can't provide the WebSocket side of online play.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { Room } = require('./room.js');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 8080;
const MAX_PLAYERS_PER_ROOM = 8;
const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no O/0/I/1

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, path: '/ws' });

const rooms = new Map(); // code -> Room

function generateCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(raw) {
  return String(raw || '').slice(0, 20).trim() || 'Player';
}

function sendError(ws, message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message }));
}

function roomFor(ws) {
  if (!ws.roomCode) return null;
  return rooms.get(ws.roomCode) || null;
}

function dropRoomIfEmpty(code) {
  const room = rooms.get(code);
  if (room && room.isEmpty()) {
    room.destroy();
    rooms.delete(code);
  }
}

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'createRoom': {
      const mode = msg.mode === 'tournament' ? 'tournament' : 'cash';
      const startingChips = [1000, 1500, 3000, 5000].includes(Number(msg.startingChips)) ? Number(msg.startingChips) : 1500;
      const botFillCount = Math.max(0, Math.min(4, Math.floor(Number(msg.botFillCount)) || 0));
      const code = generateCode();
      const playerId = crypto.randomUUID();
      const room = new Room(code, playerId);
      room.mode = mode;
      room.startingChips = startingChips;
      room.botFillCount = botFillCount;
      room.addPlayer(playerId, cleanName(msg.name), ws);
      rooms.set(code, room);
      ws.roomCode = code;
      ws.playerId = playerId;
      ws.send(JSON.stringify({ type: 'roomCreated', code, youId: playerId }));
      room.broadcastLobby();
      break;
    }
    case 'joinRoom': {
      const code = String(msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return sendError(ws, 'Room not found.');
      if (room.started) return sendError(ws, 'That game has already started.');
      if (room.humanPlayers.length >= MAX_PLAYERS_PER_ROOM) return sendError(ws, 'Room is full.');
      const playerId = crypto.randomUUID();
      room.addPlayer(playerId, cleanName(msg.name), ws);
      ws.roomCode = code;
      ws.playerId = playerId;
      ws.send(JSON.stringify({ type: 'roomJoined', code, youId: playerId }));
      room.broadcastLobby();
      break;
    }
    case 'startGame': {
      const room = roomFor(ws);
      if (!room) return;
      if (room.hostId !== ws.playerId) return sendError(ws, 'Only the host can start the game.');
      if (room.humanPlayers.length + room.botFillCount < 2) return sendError(ws, 'Need at least 2 players to start.');
      room.startGame();
      break;
    }
    case 'action': {
      const room = roomFor(ws);
      if (!room) return;
      room.applyAction(ws.playerId, msg.action, Number(msg.amount) || 0);
      break;
    }
    case 'nextHand': {
      const room = roomFor(ws);
      if (!room) return;
      room.dealNextHand();
      break;
    }
    case 'rebuy': {
      const room = roomFor(ws);
      if (!room) return;
      room.rebuy(ws.playerId);
      break;
    }
    case 'leaveRoom': {
      const room = roomFor(ws);
      if (!room) return;
      room.removePlayer(ws.playerId);
      room.broadcastLobby();
      dropRoomIfEmpty(ws.roomCode);
      ws.roomCode = null;
      ws.playerId = null;
      break;
    }
    default:
      break;
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    try {
      handleMessage(ws, msg);
    } catch (err) {
      console.error('Error handling message', msg && msg.type, err);
      sendError(ws, 'Something went wrong.');
    }
  });

  ws.on('close', () => {
    const room = roomFor(ws);
    if (!room) return;
    room.markDisconnected(ws.playerId);
    if (!room.started) room.removePlayer(ws.playerId);
    room.broadcastLobby();
    room.broadcastPresence();
    dropRoomIfEmpty(ws.roomCode);
  });
});

server.listen(PORT, () => {
  console.log(`AllInBots server listening on port ${PORT}`);
});

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const PokerGame = require('./game/PokerGame');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map(); // code -> { game, host }

const BLIND_LEVELS = [
  { label: '1 / 2',       small: 1,    big: 2    },
  { label: '5 / 10',      small: 5,    big: 10   },
  { label: '25 / 50',     small: 25,   big: 50   },
  { label: '100 / 200',   small: 100,  big: 200  },
  { label: '500 / 1000',  small: 500,  big: 1000 },
  { label: '2K / 5K',     small: 2000, big: 5000 },
];

const STARTING_CHIPS = {
  '1 / 2':      200,
  '5 / 10':     1000,
  '25 / 50':    5000,
  '100 / 200':  20000,
  '500 / 1000': 100000,
  '2K / 5K':    500000,
};

function genCode() {
  let code;
  do { code = Math.random().toString(36).substring(2, 8).toUpperCase(); }
  while (rooms.has(code));
  return code;
}

function getLobbyState(code) {
  const room = rooms.get(code);
  if (!room) return null;
  const { game } = room;
  return {
    code,
    host: room.host,
    blinds: game.blinds,
    startingChips: game.config.startingChips,
    stage: game.stage,
    players: game.players.map(p => ({ id: p.id, name: p.name, chips: p.chips, connected: p.connected }))
  };
}

function broadcastGameState(code) {
  const room = rooms.get(code);
  if (!room) return;
  const { game } = room;
  const base = game.getPublicState();

  for (const player of game.players) {
    const sockets = io.sockets.sockets;
    const sock = sockets.get(player.id);
    if (!sock) continue;
    sock.emit('game_state', {
      ...base,
      myId: player.id,
      myCards: player.cards.map(c => c.toJSON()),
      isMyTurn: base.currentPlayerId === player.id,
      isHost: room.host === player.id
    });
  }
}

function scheduleNextHand(code) {
  setTimeout(() => {
    const room = rooms.get(code);
    if (!room) return;
    const { game } = room;

    // Remove busted players
    const busted = game.players.filter(p => p.chips <= 0);
    for (const p of busted) {
      io.to(code).emit('player_busted', { name: p.name });
      game.removePlayer(p.id);
    }

    if (game.players.filter(p => p.connected).length < 2) {
      const last = game.players.find(p => p.connected);
      game.stage = 'waiting';
      io.to(code).emit('game_ended', { winner: last?.name });
      io.to(code).emit('lobby_update', getLobbyState(code));
      return;
    }

    game.stage = 'waiting';
    game.startGame();
    broadcastGameState(code);
  }, 6000);
}

io.on('connection', (socket) => {
  socket.on('get_blind_levels', () => {
    socket.emit('blind_levels', BLIND_LEVELS);
  });

  socket.on('create_lobby', ({ name, blindLabel, maxPlayers }) => {
    if (!name || !blindLabel) return socket.emit('error_msg', 'Missing name or blind level');
    const blinds = BLIND_LEVELS.find(b => b.label === blindLabel);
    if (!blinds) return socket.emit('error_msg', 'Invalid blind level');

    const code = genCode();
    const startingChips = STARTING_CHIPS[blindLabel] || blinds.big * 100;
    const game = new PokerGame({ id: code, blinds, maxPlayers: maxPlayers || 9, startingChips });

    game.addPlayer(socket.id, name, startingChips);
    rooms.set(code, { game, host: socket.id });
    socket.join(code);
    socket.data.room = code;
    socket.data.name = name;

    socket.emit('lobby_created', { code, playerId: socket.id, startingChips });
    io.to(code).emit('lobby_update', getLobbyState(code));
  });

  socket.on('join_lobby', ({ code, name }) => {
    if (!code || !name) return socket.emit('error_msg', 'Missing code or name');
    const upperCode = code.toUpperCase().trim();
    const room = rooms.get(upperCode);
    if (!room) return socket.emit('error_msg', 'Room not found. Check the code and try again.');

    const { game } = room;
    if (game.stage !== 'waiting') return socket.emit('error_msg', 'Game already in progress');

    const existing = game.players.find(p => p.id === socket.id);
    if (existing) return socket.emit('error_msg', 'Already in this room');

    const added = game.addPlayer(socket.id, name, game.config.startingChips);
    if (!added) return socket.emit('error_msg', 'Room is full');

    socket.join(upperCode);
    socket.data.room = upperCode;
    socket.data.name = name;

    socket.emit('lobby_joined', { code: upperCode, playerId: socket.id, startingChips: game.config.startingChips });
    io.to(upperCode).emit('lobby_update', getLobbyState(upperCode));
  });

  socket.on('start_game', () => {
    const code = socket.data.room;
    const room = rooms.get(code);
    if (!room) return;
    if (room.host !== socket.id) return socket.emit('error_msg', 'Only the host can start');

    const started = room.game.startGame();
    if (!started) return socket.emit('error_msg', 'Need at least 2 players to start');

    broadcastGameState(code);
  });

  socket.on('player_action', ({ action, amount }) => {
    const code = socket.data.room;
    const room = rooms.get(code);
    if (!room) return;

    const result = room.game.handleAction(socket.id, action, amount || 0);
    if (result.error) return socket.emit('error_msg', result.error);

    broadcastGameState(code);

    if (result.handOver) {
      scheduleNextHand(code);
    }
  });

  socket.on('chat_message', ({ message }) => {
    const code = socket.data.room;
    if (!code || !message) return;
    const name = socket.data.name || 'Player';
    io.to(code).emit('chat_message', { name, message: message.substring(0, 200) });
  });

  socket.on('disconnect', () => {
    const code = socket.data.room;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    const { game } = room;
    const player = game.players.find(p => p.id === socket.id);
    if (player) {
      player.connected = false;
      if (game.stage !== 'waiting' && game.getCurrentPlayer()?.id === socket.id) {
        game.handleAction(socket.id, 'fold', 0);
        broadcastGameState(code);
        const remaining = game.players.filter(p => !p.folded);
        if (remaining.length === 1) scheduleNextHand(code);
      }
    }

    if (room.host === socket.id) {
      const next = game.players.find(p => p.connected && p.id !== socket.id);
      if (next) {
        room.host = next.id;
        io.to(code).emit('host_changed', { name: next.name });
      }
    }

    io.to(code).emit('lobby_update', getLobbyState(code));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Poker server → http://localhost:${PORT}`));

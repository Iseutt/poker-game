// ═══════════════════════════════════════════
//  Poker — single-page client
// ═══════════════════════════════════════════
const socket = io();

let myId = null;
let myCode = null;
let myName = null;
let isHost = false;
let gameState = null;
let myCards = [];
let raiseMin = 0, raiseMax = 0;
let tournamentOver = false;

const STARTING_CHIPS = {
  '1 / 2': 200, '5 / 10': 1000, '25 / 50': 5000,
  '100 / 200': 20000, '500 / 1000': 100000, '2K / 5K': 500000
};

// ── Screen routing ──────────────────────────────────────────

function showScreen(name) {
  document.querySelectorAll('.card-panel').forEach(p => p.classList.add('hidden'));
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.remove('hidden');
}

function showLobbyLayer() {
  document.getElementById('lobby-layer').classList.remove('hidden');
  document.getElementById('game-layer').classList.add('hidden');
}

function showGameLayer() {
  document.getElementById('lobby-layer').classList.add('hidden');
  document.getElementById('game-layer').classList.remove('hidden');
}

// ── Helpers ──────────────────────────────────────────────────

function fmt(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'K';
  return n.toLocaleString();
}

function suitColor(suit) {
  return (suit === '♥' || suit === '♦') ? 'red' : 'black';
}

function makeCard(c, small = false) {
  const div = document.createElement('div');
  if (!c) {
    div.className = `card face-down${small ? ' card-small' : ''}`;
    return div;
  }
  div.className = `card ${suitColor(c.suit)}${small ? ' card-small' : ''}`;
  div.innerHTML = `<span class="rank">${c.rank}</span><span class="suit">${c.suit}</span>`;
  return div;
}

// ── Lobby: create ────────────────────────────────────────────

function updateBlindInfo() {
  const blind = document.getElementById('blind-select').value;
  const chips = STARTING_CHIPS[blind] || 0;
  document.getElementById('blind-info').textContent = `Starting chips: ${fmt(chips)}`;
}

function createLobby() {
  const name = document.getElementById('create-name').value.trim();
  const blindLabel = document.getElementById('blind-select').value;
  const maxPlayers = +document.getElementById('max-players').value;
  if (!name) { showToast('Enter your name'); return; }
  if (!maxPlayers || maxPlayers < 2 || maxPlayers > 9) { showToast('Max players must be 2 – 9'); return; }
  myName = name;
  socket.emit('create_lobby', { name, blindLabel, maxPlayers });
}

// ── Lobby: join ──────────────────────────────────────────────

function joinLobby() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!name) { showToast('Enter your name'); return; }
  if (!code) { showToast('Enter the table code'); return; }
  myName = name;
  socket.emit('join_lobby', { name, code });
}

function copyCode() {
  navigator.clipboard.writeText(myCode).then(() => showToast('Code copied!'));
}

function startGame() {
  socket.emit('start_game');
}

function leaveGame() {
  myId = null; myCode = null; myName = null; isHost = false;
  tournamentOver = false;
  showLobbyLayer();
  showScreen('main');
}

function startNewGame() {
  socket.emit('restart_game');
}

// ── Socket: lobby events ─────────────────────────────────────

socket.on('lobby_created', ({ code, playerId }) => {
  myId = playerId;
  myCode = code;
  isHost = true;
  document.getElementById('room-code').textContent = code;
  showScreen('lobby');
});

socket.on('lobby_joined', ({ code, playerId }) => {
  myId = playerId;
  myCode = code;
  document.getElementById('room-code').textContent = code;
  showScreen('lobby');
});

socket.on('lobby_update', (state) => {
  if (!state) return;
  isHost = state.host === myId;

  // Update lobby panel
  const list = document.getElementById('player-list');
  if (list) {
    list.innerHTML = '';
    for (const p of state.players) {
      const div = document.createElement('div');
      div.className = 'player-item';
      const badges = [];
      if (p.id === state.host) badges.push('<span class="p-badge badge-host">Host</span>');
      if (p.id === myId) badges.push('<span class="p-badge badge-you">You</span>');
      if (!p.connected) badges.push('<span class="p-badge badge-disc">Disconnected</span>');
      div.innerHTML = `<span class="p-name">${p.name}${badges.join('')}</span>
                       <span class="p-chips">${fmt(p.chips)}</span>`;
      list.appendChild(div);
    }
  }

  const bb = document.getElementById('blind-badge');
  if (bb) bb.textContent = `Blinds: ${state.blinds.small} / ${state.blinds.big}`;

  const startBtn = document.getElementById('start-btn');
  const waitMsg = document.getElementById('waiting-msg');
  const canStart = isHost && state.players.filter(p => p.connected).length >= 2;

  if (startBtn) startBtn.style.display = canStart ? 'block' : 'none';
  if (waitMsg) {
    waitMsg.style.display = canStart ? 'none' : 'block';
    waitMsg.textContent = state.players.length < 2
      ? 'Waiting for players… Share the code!'
      : `${state.players.filter(p => p.connected).length} player(s) ready`;
  }

  // Also update game-layer waiting overlay if in game
  const waitPlayers = document.getElementById('wait-players');
  if (waitPlayers) waitPlayers.textContent = state.players.filter(p => p.connected).length + ' player(s) connected';
  const waitCode = document.getElementById('wait-code');
  if (waitCode) waitCode.textContent = state.code || myCode;
  const hostStartBtn = document.getElementById('host-start-btn');
  if (hostStartBtn) {
    if (canStart && document.getElementById('game-layer') && !document.getElementById('game-layer').classList.contains('hidden')) {
      hostStartBtn.classList.remove('hidden');
    } else {
      hostStartBtn.classList.add('hidden');
    }
  }

  const infoCode = document.getElementById('info-code');
  if (infoCode) infoCode.textContent = state.code || myCode;
  const infoBlinds = document.getElementById('info-blinds');
  if (infoBlinds) infoBlinds.textContent = `${state.blinds.small}/${state.blinds.big}`;
});

// ── Socket: game events ──────────────────────────────────────

socket.on('game_state', (state) => {
  gameState = state;
  myId = state.myId;
  myCards = state.myCards || [];
  isHost = state.isHost;
  tournamentOver = false;

  showGameLayer();
  document.getElementById('waiting-overlay').classList.add('hidden');
  render(state);
});

socket.on('game_ended', ({ winner }) => {
  addChat('system', `${winner || 'Someone'} is the last player — waiting for others to reconnect…`);
});

socket.on('tournament_over', ({ winner, hostId }) => {
  tournamentOver = true;
  const overlay = document.getElementById('winner-overlay');
  overlay.classList.remove('hidden');
  const imHost = hostId === myId;
  const actionHtml = imHost
    ? `<button class="btn-action btn-raise" style="margin-top:18px;width:100%;font-size:1rem;padding:14px;" onclick="startNewGame()">▶ Start New Game</button>`
    : `<p style="color:rgba(255,255,255,0.5);font-size:0.9rem;margin-top:14px;">Waiting for host to start a new game…</p>`;
  document.getElementById('winner-content').innerHTML =
    `<h2>Tournament Over!</h2>
     <div class="winner-name">🏆 ${winner || 'Last Player'}</div>
     <div class="winner-hand">wins the tournament!</div>
     ${actionHtml}`;
});

socket.on('player_busted', ({ name }) => addChat('system', `${name} is out of chips and is now spectating`));
socket.on('host_changed', ({ name }) => { addChat('system', `${name} is now the host`); });

socket.on('error_msg', (msg) => {
  showToast(msg);
  const el = document.getElementById('lobby-error');
  if (el) { el.textContent = msg; setTimeout(() => { el.textContent = ''; }, 3000); }
});

socket.on('chat_message', ({ name, message }) => addChat(name, message));

// ── Rendering ─────────────────────────────────────────────────

function render(state) {
  renderInfoBar(state);
  renderCommunity(state);
  renderPlayers(state);
  renderMyCards();
  renderActions(state);
  renderWinner(state);
}

function renderInfoBar(state) {
  document.getElementById('info-blinds').textContent =
    `Blinds: ${fmt(state.blinds.small)} / ${fmt(state.blinds.big)}`;
  document.getElementById('info-code').textContent = myCode || '';
}

function renderCommunity(state) {
  document.getElementById('stage-label').textContent = state.stage.toUpperCase();
  document.getElementById('pot-display').textContent =
    state.pot > 0 ? `POT: ${fmt(state.pot)}` : '';

  const cc = document.getElementById('community-cards');
  cc.innerHTML = '';
  for (const c of state.communityCards) cc.appendChild(makeCard(c));
  for (let i = state.communityCards.length; i < 5; i++) {
    const ph = document.createElement('div');
    ph.style.cssText = 'width:52px;height:74px;border:1px dashed rgba(255,255,255,0.1);border-radius:6px;flex-shrink:0;';
    cc.appendChild(ph);
  }

  const la = document.getElementById('last-action-label');
  if (state.lastAction) {
    const { name, action, amount } = state.lastAction;
    la.textContent = `${name} ${action}${amount > 0 ? ' ' + fmt(amount) : ''}`;
  } else {
    la.textContent = '';
  }
}

function renderPlayers(state) {
  const container = document.getElementById('players-container');
  container.innerHTML = '';

  const players = state.players;
  const positions = getPositions(players.length);

  players.forEach((p, i) => {
    const seat = document.createElement('div');
    seat.className = 'player-seat';
    if (p.id === myId) seat.classList.add('you');
    if (p.id === state.currentPlayerId && !['showdown','waiting'].includes(state.stage)) seat.classList.add('active');
    if (p.folded) seat.classList.add('folded');

    const [px, py] = positions[i];
    seat.style.left = px + '%';
    seat.style.top = py + '%';

    // Cards row (for other players / showdown)
    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'player-cards';

    if (p.id !== myId || state.stage === 'showdown') {
      if (p.cards && p.cards.length > 0) {
        for (const c of p.cards) cardsDiv.appendChild(makeCard(c, true));
      } else if (p.cardCount > 0 && !p.folded) {
        for (let j = 0; j < p.cardCount; j++) cardsDiv.appendChild(makeCard(null, true));
      }
    }

    // Avatar
    const avatar = document.createElement('div');
    avatar.className = 'player-avatar';
    avatar.textContent = (p.name || '?')[0].toUpperCase();
    if (!p.connected) avatar.style.opacity = '0.3';

    if (p.isDealer) {
      const d = document.createElement('div');
      d.className = 'dealer-btn'; d.textContent = 'D';
      avatar.appendChild(d);
    }
    if (p.isSB && !p.isDealer) {
      const b = document.createElement('div');
      b.className = 'blind-btn sb'; b.textContent = 'SB';
      avatar.appendChild(b);
    }
    if (p.isBB) {
      const b = document.createElement('div');
      b.className = 'blind-btn bb'; b.textContent = 'BB';
      avatar.appendChild(b);
    }

    const nameDiv = document.createElement('div');
    nameDiv.className = 'player-name';
    nameDiv.textContent = p.name + (p.id === myId ? ' ★' : '');

    const chipsDiv = document.createElement('div');
    chipsDiv.className = 'player-chips';
    chipsDiv.textContent = p.allIn ? '⚡ ALL-IN' : fmt(p.chips);

    const betDiv = document.createElement('div');
    betDiv.className = 'player-bet';
    betDiv.textContent = p.bet > 0 ? fmt(p.bet) : '';

    seat.appendChild(cardsDiv);
    seat.appendChild(avatar);
    seat.appendChild(nameDiv);
    seat.appendChild(chipsDiv);
    seat.appendChild(betDiv);
    container.appendChild(seat);
  });
}

function renderMyCards() {
  const panel = document.getElementById('my-hole-cards');
  panel.innerHTML = '';
  if (gameState && gameState.isSpectator) {
    const badge = document.createElement('div');
    badge.className = 'spectator-badge';
    badge.textContent = 'SPECTATING';
    panel.appendChild(badge);
    return;
  }
  if (!myCards || myCards.length === 0) return;
  for (const c of myCards) panel.appendChild(makeCard(c));
}

function renderActions(state) {
  const panel = document.getElementById('action-panel');
  if (state.isSpectator || !state.isMyTurn || ['showdown','waiting'].includes(state.stage)) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');

  const me = state.players.find(p => p.id === myId);
  if (!me) return;

  const toCall = Math.max(0, state.currentBet - me.bet);
  document.getElementById('current-bet-info').textContent =
    toCall > 0
      ? `Current bet: ${fmt(state.currentBet)} — To call: ${fmt(Math.min(toCall, me.chips))}`
      : 'Your bet — no bet to call';

  const btnCheck = document.getElementById('btn-check');
  const btnCall = document.getElementById('btn-call');

  if (toCall <= 0) {
    btnCheck.style.display = 'inline-block';
    btnCall.style.display = 'none';
  } else {
    btnCheck.style.display = 'none';
    btnCall.style.display = 'inline-block';
    btnCall.textContent = `Call ${fmt(Math.min(toCall, me.chips))}`;
  }

  // Disable raise if not enough chips
  const btnRaise = document.querySelector('.btn-raise');
  if (btnRaise) btnRaise.style.opacity = me.chips <= toCall ? '0.4' : '1';
}

function renderWinner(state) {
  if (tournamentOver) return;
  const overlay = document.getElementById('winner-overlay');
  if (!state.winners || state.stage !== 'showdown') {
    overlay.classList.add('hidden');
    return;
  }
  overlay.classList.remove('hidden');
  const lines = state.winners.map(w =>
    `<div class="winner-name">🏆 ${w.name}</div>
     <div class="winner-hand">${w.handName}</div>
     <div class="winner-amount">+${fmt(w.amount)}</div>`
  ).join('<hr style="margin:10px 0;opacity:0.2">');
  document.getElementById('winner-content').innerHTML =
    `<h2>Winner${state.winners.length > 1 ? 's' : ''}!</h2>${lines}`;
}

// ── Player positions ──────────────────────────────────────────

function getPositions(n) {
  const cx = 50, cy = 50, rx = 52, ry = 56;
  const startAngle = Math.PI / 2;
  return Array.from({ length: n }, (_, i) => {
    const a = startAngle + (2 * Math.PI * i) / n;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });
}

// ── Actions ───────────────────────────────────────────────────

function act(action, amount) {
  socket.emit('player_action', { action, amount: amount || 0 });
  document.getElementById('action-panel').classList.add('hidden');
}

function openRaise() {
  if (!gameState) return;
  const me = gameState.players.find(p => p.id === myId);
  if (!me || me.chips === 0) return;

  raiseMin = gameState.currentBet + (gameState.minRaise || gameState.blinds?.big || 2);
  raiseMax = me.chips + me.bet;
  raiseMin = Math.min(raiseMin, raiseMax);

  const slider = document.getElementById('raise-slider');
  slider.min = raiseMin;
  slider.max = raiseMax;
  slider.step = Math.max(1, gameState.blinds?.big || 1);
  slider.value = raiseMin;

  document.getElementById('raise-info').textContent =
    `Min: ${fmt(raiseMin)} — Max: ${fmt(raiseMax)}`;
  updateRaiseDisplay();
  document.getElementById('raise-overlay').classList.remove('hidden');
}

function updateRaiseDisplay() {
  const val = +document.getElementById('raise-slider').value;
  document.getElementById('raise-value-display').textContent = fmt(val);
}

function setRaiseMultiple(mult) {
  if (!gameState) return;
  const target = Math.floor(gameState.pot * mult) + gameState.currentBet;
  const val = Math.min(Math.max(target, raiseMin), raiseMax);
  document.getElementById('raise-slider').value = val;
  updateRaiseDisplay();
}

function setRaiseMax() {
  document.getElementById('raise-slider').value = raiseMax;
  updateRaiseDisplay();
}

function confirmRaise() {
  const amount = +document.getElementById('raise-slider').value;
  closeRaise();
  act('raise', amount);
}

function closeRaise() {
  document.getElementById('raise-overlay').classList.add('hidden');
}

// ── Chat ──────────────────────────────────────────────────────

function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit('chat_message', { message: msg });
  input.value = '';
}

function chatKey(e) {
  if (e.key === 'Enter') sendChat();
}

function addChat(name, message) {
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  if (name === 'system') {
    div.className = 'chat-msg chat-system';
    div.textContent = '⚡ ' + message;
  } else {
    div.className = 'chat-msg';
    div.innerHTML = `<span class="chat-name">${name}:</span> <span class="chat-text">${message}</span>`;
  }
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Toast ─────────────────────────────────────────────────────

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Init ──────────────────────────────────────────────────────

// Handle ?code= in URL for direct join links
const urlParams = new URLSearchParams(location.search);
const urlCode = urlParams.get('code');
if (urlCode) {
  document.getElementById('join-code').value = urlCode;
  showScreen('join');
}

updateBlindInfo();

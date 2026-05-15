const { Deck } = require('./Deck');
const { evaluate } = require('./HandEvaluator');

const STAGES = ['waiting', 'preflop', 'flop', 'turn', 'river', 'showdown'];

class PokerGame {
  constructor(config) {
    this.config = config;
    this.blinds = config.blinds;
    this.maxPlayers = config.maxPlayers || 9;
    this.players = [];
    this.stage = 'waiting';
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = config.blinds.big;
    this.dealerIndex = -1;
    this.currentPlayerIndex = -1;
    this.needToAct = new Set();
    this.lastAction = null;
    this.winners = null;
    this.sbIndex = -1;
    this.bbIndex = -1;
    this.deck = null;
    this._lastStanding = false;
  }

  addPlayer(id, name, chips) {
    if (this.players.length >= this.maxPlayers) return false;
    if (this.players.find(p => p.id === id)) return false;
    this.players.push({ id, name, chips, cards: [], bet: 0, folded: false, allIn: false, connected: true });
    return true;
  }

  removePlayer(id) {
    const idx = this.players.findIndex(p => p.id === id);
    if (idx === -1) return false;
    this.players.splice(idx, 1);
    return true;
  }

  getActivePlayers() {
    return this.players.filter(p => !p.folded && p.chips >= 0);
  }

  getEligiblePlayers() {
    return this.players.filter(p => !p.folded && !p.allIn);
  }

  getCurrentPlayer() {
    if (this.currentPlayerIndex < 0 || this.currentPlayerIndex >= this.players.length) return null;
    return this.players[this.currentPlayerIndex];
  }

  nextActiveIndex(from) {
    let idx = (from + 1) % this.players.length;
    let tried = 0;
    while ((this.players[idx].folded || !this.players[idx].connected) && tried < this.players.length) {
      idx = (idx + 1) % this.players.length;
      tried++;
    }
    return idx;
  }

  startGame() {
    if (this.players.filter(p => p.connected).length < 2) return false;
    if (this.stage !== 'waiting') return false;
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    this.startHand();
    return true;
  }

  startHand() {
    this.deck = new Deck();
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = this.blinds.big;
    this.winners = null;
    this.lastAction = null;
    this._lastStanding = false;

    for (const p of this.players) {
      p.cards = [];
      p.bet = 0;
      p.folded = false;
      p.allIn = false;
    }

    const active = this.players.filter(p => p.connected);
    if (active.length < 2) { this.stage = 'waiting'; return; }

    // Advance dealer to next connected player
    let dealer = this.dealerIndex % this.players.length;
    while (!this.players[dealer].connected) dealer = (dealer + 1) % this.players.length;
    this.dealerIndex = dealer;

    // SB = next after dealer, BB = next after SB
    this.sbIndex = this.nextActiveIndex(this.dealerIndex);
    this.bbIndex = this.nextActiveIndex(this.sbIndex);

    // Post blinds
    this._postBlind(this.sbIndex, this.blinds.small);
    this._postBlind(this.bbIndex, this.blinds.big);
    this.currentBet = this.blinds.big;

    // Deal 2 cards to each active player
    for (let i = 0; i < 2; i++) {
      for (const p of this.players) {
        if (p.connected) p.cards.push(this.deck.deal());
      }
    }

    this.stage = 'preflop';

    // Pre-flop: first to act is UTG (after BB)
    // needToAct includes BB (they can re-raise even if everyone calls)
    this.needToAct = new Set(this.players.filter(p => p.connected && !p.allIn).map(p => p.id));
    this.currentPlayerIndex = this.nextActiveIndex(this.bbIndex);
  }

  _postBlind(idx, amount) {
    const p = this.players[idx];
    const paid = Math.min(amount, p.chips);
    p.chips -= paid;
    p.bet += paid;
    this.pot += paid;
    if (p.chips === 0) p.allIn = true;
  }

  handleAction(playerId, action, raiseAmount) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return { error: 'Player not found' };

    const current = this.getCurrentPlayer();
    if (!current || current.id !== playerId) return { error: 'Not your turn' };
    if (player.folded || player.allIn) return { error: 'Cannot act' };

    this.lastAction = { playerId, name: player.name, action, amount: 0 };

    if (action === 'fold') {
      player.folded = true;

    } else if (action === 'check') {
      if (this.currentBet > player.bet) return { error: 'Cannot check — must call or raise' };

    } else if (action === 'call') {
      const toCall = Math.min(this.currentBet - player.bet, player.chips);
      player.chips -= toCall;
      player.bet += toCall;
      this.pot += toCall;
      this.lastAction.amount = toCall;
      if (player.chips === 0) player.allIn = true;

    } else if (action === 'raise') {
      const totalBet = Math.min(raiseAmount, player.chips + player.bet);
      const extra = totalBet - player.bet;
      if (extra <= 0) return { error: 'Invalid raise amount' };
      if (totalBet < this.currentBet + this.minRaise && extra < player.chips) {
        return { error: 'Raise too small' };
      }
      this.minRaise = totalBet - this.currentBet;
      player.chips -= extra;
      player.bet = totalBet;
      this.pot += extra;
      this.currentBet = totalBet;
      this.lastAction.amount = extra;
      if (player.chips === 0) player.allIn = true;
      // Re-open action: everyone except raiser must act again
      this.needToAct = new Set(
        this.players.filter(p => !p.folded && !p.allIn && p.id !== playerId && p.connected).map(p => p.id)
      );

    } else if (action === 'allin') {
      const extra = player.chips;
      if (player.bet + extra > this.currentBet) {
        this.minRaise = (player.bet + extra) - this.currentBet;
        this.currentBet = player.bet + extra;
        this.needToAct = new Set(
          this.players.filter(p => !p.folded && !p.allIn && p.id !== playerId && p.connected).map(p => p.id)
        );
      }
      player.bet += extra;
      this.pot += extra;
      player.chips = 0;
      player.allIn = true;
      this.lastAction.amount = extra;

    } else {
      return { error: 'Unknown action' };
    }

    this.needToAct.delete(playerId);

    // Check if only one player remains
    const remaining = this.players.filter(p => !p.folded);
    if (remaining.length === 1) {
      const wonAmount = this.pot;
      remaining[0].chips += wonAmount;
      this.lastAction = { ...this.lastAction, wonPot: wonAmount };
      this.pot = 0;
      this._lastStanding = true;
      this.winners = [{ id: remaining[0].id, name: remaining[0].name, handName: 'Last Player Standing', amount: wonAmount }];
      this.stage = 'showdown';
      return { handOver: true };
    }

    // Advance or go to next stage
    if (this._isBettingRoundOver()) {
      this._advanceStage();
    } else {
      this._advanceToNextPlayer();
    }

    // _advanceStage may have triggered _doShowdown — if so, hand is over
    if (this.stage === 'showdown') return { handOver: true };
    return { success: true };
  }

  _isBettingRoundOver() {
    if (this.needToAct.size > 0) return false;
    // Also ensure all eligible players have matched the bet
    for (const p of this.players) {
      if (!p.folded && !p.allIn && p.bet < this.currentBet) return false;
    }
    return true;
  }

  _advanceToNextPlayer() {
    let idx = this.nextActiveIndex(this.currentPlayerIndex);
    let tries = 0;
    while (tries < this.players.length) {
      const p = this.players[idx];
      if (!p.folded && !p.allIn && this.needToAct.has(p.id)) {
        this.currentPlayerIndex = idx;
        return;
      }
      idx = this.nextActiveIndex(idx);
      tries++;
    }
    // No eligible player found — round is over
    this._advanceStage();
  }

  _advanceStage() {
    const stages = ['preflop', 'flop', 'turn', 'river', 'showdown'];
    const idx = stages.indexOf(this.stage);

    // Reset bets
    for (const p of this.players) p.bet = 0;
    this.currentBet = 0;
    this.minRaise = this.blinds.big;

    if (this.stage === 'preflop') {
      this.communityCards.push(this.deck.deal(), this.deck.deal(), this.deck.deal());
      this.stage = 'flop';
    } else if (this.stage === 'flop') {
      this.communityCards.push(this.deck.deal());
      this.stage = 'turn';
    } else if (this.stage === 'turn') {
      this.communityCards.push(this.deck.deal());
      this.stage = 'river';
    } else if (this.stage === 'river') {
      this._doShowdown();
      return;
    }

    // Reset needToAct for new street
    this.needToAct = new Set(
      this.players.filter(p => !p.folded && !p.allIn && p.connected).map(p => p.id)
    );

    // Post-flop: first to act is first active after dealer
    let startIdx = this.nextActiveIndex(this.dealerIndex);
    let tries = 0;
    while (this.players[startIdx].folded || this.players[startIdx].allIn) {
      startIdx = this.nextActiveIndex(startIdx);
      if (++tries > this.players.length) break;
    }
    this.currentPlayerIndex = startIdx;

    // If no one needs to act (all-in scenario), jump to showdown
    if (this.needToAct.size === 0) {
      this._advanceStage();
    }
  }

  _doShowdown() {
    this.stage = 'showdown';
    const contenders = this.players.filter(p => !p.folded);

    // Evaluate each hand
    const results = contenders.map(p => ({
      player: p,
      result: evaluate(p.cards, this.communityCards)
    }));

    // Sort best first
    results.sort((a, b) => b.result.score - a.result.score);

    // Award pot (simplified — no side pots for now)
    // TODO: implement side pots for multi-way all-in
    const topScore = results[0].result.score;
    const winners = results.filter(r => r.result.score === topScore);
    const share = Math.floor(this.pot / winners.length);
    const remainder = this.pot - share * winners.length;

    this.winners = winners.map((w, i) => ({
      id: w.player.id,
      name: w.player.name,
      handName: w.result.name,
      amount: share + (i === 0 ? remainder : 0)
    }));

    for (const w of this.winners) {
      const p = this.players.find(pl => pl.id === w.id);
      if (p) p.chips += w.amount;
    }
    this.pot = 0;
  }

  getPublicState() {
    return {
      stage: this.stage,
      blinds: this.blinds,
      communityCards: this.communityCards.map(c => c.toJSON()),
      pot: this.pot,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      dealerIndex: this.dealerIndex,
      sbIndex: this.sbIndex,
      bbIndex: this.bbIndex,
      currentPlayerId: this.getCurrentPlayer()?.id || null,
      lastAction: this.lastAction,
      winners: this.winners,
      lastStanding: this._lastStanding,
      players: this.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        chips: p.chips,
        bet: p.bet,
        folded: p.folded,
        allIn: p.allIn,
        connected: p.connected,
        cardCount: p.cards.length,
        isDealer: i === this.dealerIndex,
        isSB: i === this.sbIndex,
        isBB: i === this.bbIndex,
        // Reveal cards at real showdown (not last-player-standing)
        cards: (this.stage === 'showdown' && !p.folded && !this._lastStanding) ? p.cards.map(c => c.toJSON()) : null
      }))
    };
  }
}

module.exports = PokerGame;

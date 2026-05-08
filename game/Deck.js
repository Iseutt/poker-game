class Card {
  constructor(suit, rank) {
    this.suit = suit;
    this.rank = rank;
  }

  getValue() {
    const vals = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };
    return vals[this.rank];
  }

  toJSON() {
    return { suit: this.suit, rank: this.rank };
  }
}

class Deck {
  constructor() {
    this.reset();
  }

  reset() {
    const suits = ['♠', '♥', '♦', '♣'];
    const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    this.cards = [];
    for (const suit of suits) {
      for (const rank of ranks) {
        this.cards.push(new Card(suit, rank));
      }
    }
    this.shuffle();
  }

  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  deal() {
    if (this.cards.length === 0) throw new Error('Deck is empty');
    return this.cards.pop();
  }
}

module.exports = { Card, Deck };

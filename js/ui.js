// Rendering layer: turns game state into DOM. Knows nothing about game rules.

const UI = {
  seatsEl: null,
  els: {},

  init() {
    this.seatsEl = document.getElementById('seats');
    this.els = {
      community: document.getElementById('community-cards'),
      pot: document.getElementById('pot-display'),
      street: document.getElementById('street-label'),
      handNumber: document.getElementById('hand-number'),
      blindInfo: document.getElementById('blind-info'),
      levelInfo: document.getElementById('level-info'),
      modeBadge: document.getElementById('mode-badge'),
      resultBanner: document.getElementById('result-banner'),
      resultText: document.getElementById('result-text'),
      rebuyBanner: document.getElementById('rebuy-banner'),
      rebuyText: document.getElementById('rebuy-text'),
      gameoverBanner: document.getElementById('gameover-banner'),
      gameoverText: document.getElementById('gameover-text'),
      passDeviceBanner: document.getElementById('pass-device-banner'),
      passDeviceText: document.getElementById('pass-device-text'),
      logContent: document.getElementById('log-content'),
      actionButtons: document.getElementById('action-buttons'),
      foldBtn: document.getElementById('fold-btn'),
      checkCallBtn: document.getElementById('check-call-btn'),
      raiseBtn: document.getElementById('raise-btn'),
      allinBtn: document.getElementById('allin-btn'),
      raiseSlider: document.getElementById('raise-slider'),
      raiseInput: document.getElementById('raise-input'),
    };
  },

  cardHTML(card, faceDown) {
    if (faceDown) {
      return `<div class="card back"></div>`;
    }
    const red = isRedSuit(card.suit);
    return `<div class="card ${red ? 'red' : 'black'}">
      <span class="rank">${rankLabel(card.rank)}</span>
      <span class="suit">${suitSymbol(card.suit)}</span>
    </div>`;
  },

  renderCommunity(board) {
    const cards = board.map((c) => this.cardHTML(c, false)).join('');
    const placeholders = Array(5 - board.length).fill('<div class="card placeholder"></div>').join('');
    this.els.community.innerHTML = cards + placeholders;
  },

  renderPot(amount) {
    this.els.pot.textContent = `Pot: ${amount.toLocaleString()}`;
  },

  renderStreet(label) {
    this.els.street.textContent = label || '';
  },

  seatPosition(slot, n) {
    const angle = ((90 + (360 / n) * slot) * Math.PI) / 180;
    const rx = 43;
    const ry = 40;
    const x = 50 + rx * Math.cos(angle);
    const y = 50 + ry * Math.sin(angle);
    return { left: `${x}%`, top: `${y}%` };
  },

  renderSeats(game, options) {
    const { revealAll = false, activePlayerId = null, showdownHands = null, centerId = null, revealIds = [] } = options || {};
    const n = game.players.length;
    let centerIndex = centerId ? game.players.findIndex((p) => p.id === centerId) : -1;
    if (centerIndex === -1) centerIndex = 0;
    this.seatsEl.innerHTML = '';

    game.players.forEach((p, idx) => {
      const slot = (idx - centerIndex + n) % n;
      const pos = this.seatPosition(slot, n);
      const seat = document.createElement('div');
      seat.className = 'seat';
      seat.style.left = pos.left;
      seat.style.top = pos.top;
      if (p.busted) seat.classList.add('busted');
      if (p.folded) seat.classList.add('folded');
      if (p.id === activePlayerId) seat.classList.add('active-turn');
      if (game.dealerIndex === idx) seat.classList.add('has-dealer');

      const showCards = revealAll || revealIds.includes(p.id);
      const holeHTML = (p.holeCards || []).map((c) => this.cardHTML(c, !showCards)).join('');

      const showdownEntry = showdownHands && showdownHands.find((s) => s.playerId === p.id);
      const handLabel = showdownEntry ? `<div class="hand-label">${showdownEntry.hand}</div>` : '';

      seat.innerHTML = `
        <div class="seat-cards">${holeHTML}</div>
        <div class="seat-info ${p.isHuman ? 'is-human' : ''}">
          <div class="seat-name">${p.name}${game.dealerIndex === idx ? ' <span class="dealer-chip">D</span>' : ''}</div>
          <div class="seat-chips">${p.busted ? 'Busted' : p.chips.toLocaleString()}</div>
          ${p.betThisStreet ? `<div class="seat-bet">Bet ${p.betThisStreet}</div>` : ''}
          ${p.allIn ? '<div class="seat-tag allin">ALL-IN</div>' : ''}
          ${p.folded && !p.busted ? '<div class="seat-tag folded">FOLD</div>' : ''}
          ${handLabel}
        </div>
      `;
      this.seatsEl.appendChild(seat);
    });
  },

  setHUD({ mode, blinds, level, handNumber, handsPerLevel }) {
    this.els.modeBadge.textContent = mode === 'tournament' ? 'Tournament' : 'Cash Game';
    this.els.blindInfo.textContent = `Blinds ${blinds.small} / ${blinds.big}`;
    this.els.handNumber.textContent = `Hand #${handNumber}`;
    if (mode === 'tournament') {
      this.els.levelInfo.classList.remove('hidden');
      const remainder = handsPerLevel - (((handNumber - 1) % handsPerLevel) + 1);
      this.els.levelInfo.textContent = `Level ${level + 1} · next in ${remainder + 1} hand${remainder === 0 ? '' : 's'}`;
    } else {
      this.els.levelInfo.classList.add('hidden');
    }
  },

  log(message) {
    const line = document.createElement('div');
    line.className = 'log-line';
    line.textContent = message;
    this.els.logContent.appendChild(line);
    this.els.logContent.scrollTop = this.els.logContent.scrollHeight;
  },

  clearLog() {
    this.els.logContent.innerHTML = '';
  },

  showActionButtons(show) {
    this.els.actionButtons.classList.toggle('disabled', !show);
    for (const btn of [this.els.foldBtn, this.els.checkCallBtn, this.els.raiseBtn, this.els.allinBtn]) {
      btn.disabled = !show;
    }
    this.els.raiseSlider.disabled = !show;
    this.els.raiseInput.disabled = !show;
  },

  configureActions(legal) {
    this.els.checkCallBtn.textContent = legal.toCall > 0 ? `Call ${legal.toCall}` : 'Check';
    this.els.raiseBtn.textContent = legal.toCall > 0 ? 'Raise to' : 'Bet';
    this.els.raiseBtn.disabled = !legal.canRaise;
    this.els.raiseSlider.min = legal.minRaiseTotal;
    this.els.raiseSlider.max = legal.maxRaiseTotal;
    this.els.raiseSlider.value = legal.minRaiseTotal;
    this.els.raiseInput.min = legal.minRaiseTotal;
    this.els.raiseInput.max = legal.maxRaiseTotal;
    this.els.raiseInput.value = legal.minRaiseTotal;
    this.els.raiseSlider.disabled = !legal.canRaise;
    this.els.raiseInput.disabled = !legal.canRaise;
  },

  showResult(text) {
    this.els.resultText.innerHTML = text;
    this.els.resultBanner.classList.remove('hidden');
  },

  hideResult() {
    this.els.resultBanner.classList.add('hidden');
  },

  showRebuy(show, names) {
    this.els.rebuyBanner.classList.toggle('hidden', !show);
    if (show && names && names.length) {
      this.els.rebuyText.textContent = names.length === 1
        ? `${names[0]} is out of chips.`
        : `${names.join(', ')} are out of chips.`;
    }
  },

  showPassDevice(show, name) {
    this.els.passDeviceBanner.classList.toggle('hidden', !show);
    if (show) {
      this.els.passDeviceText.innerHTML = `Pass the device to <strong>${name}</strong>`;
    }
  },

  showGameOver(text) {
    this.els.gameoverText.innerHTML = text;
    this.els.gameoverBanner.classList.remove('hidden');
  },

  hideGameOver() {
    this.els.gameoverBanner.classList.add('hidden');
  },
};

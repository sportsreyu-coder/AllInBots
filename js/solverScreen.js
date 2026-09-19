// DOM wiring for the standalone preflop solver screen. Talks to js/solver.js
// (pure computation) and renders a 13x13 range grid plus a summary panel.

const SOLVER_CATEGORY_LABEL = {
  value: 'Value',
  speculative: 'Implied Odds',
  bluff: 'Bluff',
  fold: 'Fold',
};

const SolverScreen = {
  initialized: false,

  open() {
    if (!this.initialized) {
      this.bindControls();
      this.initialized = true;
    }
    App.showScreen('solver');
    this.render();
  },

  bindControls() {
    document.getElementById('solver-back-btn').addEventListener('click', () => {
      App.showScreen('setup');
    });

    const playersInput = document.getElementById('solver-players');
    const playersLabel = document.getElementById('solver-players-label');
    playersInput.addEventListener('input', () => {
      playersLabel.textContent = `${playersInput.value} players`;
      this.render();
    });

    document.getElementById('solver-position').addEventListener('change', () => this.render());

    const typeButtons = document.querySelectorAll('.solver-type-btn');
    typeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        typeButtons.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.render();
      });
    });

    const stackInput = document.getElementById('solver-stack');
    const stackLabel = document.getElementById('solver-stack-label');
    stackInput.addEventListener('input', () => {
      stackLabel.textContent = `${stackInput.value} BB`;
      this.render();
    });

    const bluffInput = document.getElementById('solver-bluff');
    const bluffLabel = document.getElementById('solver-bluff-label');
    bluffInput.addEventListener('input', () => {
      bluffLabel.textContent = `${bluffInput.value}%`;
      this.render();
    });
  },

  readParams() {
    const gameType = document.querySelector('.solver-type-btn.selected').dataset.gameType;
    return {
      players: Number(document.getElementById('solver-players').value),
      position: document.getElementById('solver-position').value,
      gameType,
      stackBB: Number(document.getElementById('solver-stack').value),
      bluffFreq: Number(document.getElementById('solver-bluff').value),
    };
  },

  render() {
    const params = this.readParams();
    const result = solveRange(params);
    const categoryByLabel = new Map(result.cells.map((c) => [c.label, c.category]));

    this.renderGrid(categoryByLabel, result.shortStack);
    this.renderLegend(result.shortStack);
    this.renderSummary(params, result);
  },

  renderGrid(categoryByLabel, shortStack) {
    const grid = document.getElementById('solver-grid');
    grid.innerHTML = '';
    for (let i = 0; i < SOLVER_RANKS.length; i++) {
      for (let j = 0; j < SOLVER_RANKS.length; j++) {
        const hi = SOLVER_RANKS[Math.min(i, j)];
        const lo = SOLVER_RANKS[Math.max(i, j)];
        const isPair = i === j;
        const suited = i < j;
        const label = isPair
          ? `${rankLabel(hi)}${rankLabel(lo)}`
          : `${rankLabel(hi)}${rankLabel(lo)}${suited ? 's' : 'o'}`;
        const category = categoryByLabel.get(label) || 'fold';

        const cell = document.createElement('div');
        cell.className = `solver-cell solver-cell-${category}`;
        cell.textContent = label;
        cell.title = `${label} — ${SOLVER_CATEGORY_LABEL[category]}${shortStack ? ' (push/fold)' : ''}`;
        grid.appendChild(cell);
      }
    }
  },

  renderLegend(shortStack) {
    const legend = document.getElementById('solver-legend');
    const raiseWord = shortStack ? 'Shove' : 'Raise';
    const entries = [
      ['value', `${raiseWord} — Value`],
      ['speculative', `${raiseWord} — Implied Odds`],
      ['bluff', `${raiseWord} — Bluff`],
      ['fold', 'Fold'],
    ];
    legend.innerHTML = entries
      .map(([cat, text]) => `<span class="solver-legend-item"><span class="solver-swatch solver-cell-${cat}"></span>${text}</span>`)
      .join('');
  },

  renderSummary(params, result) {
    const { stats, shortStack } = result;
    const positionLabel = {
      early: 'Early position', middle: 'Middle position', late: 'Late position',
      button: 'the Button', sb: 'the Small Blind', bb: 'the Big Blind',
    }[params.position];
    const gameLabel = params.gameType === 'tournament' ? 'tournament' : 'cash game';
    const raiseWord = shortStack ? 'shoving' : 'opening';

    const parts = [];
    parts.push(
      `<div class="solver-summary-line"><strong>${params.players}-handed ${gameLabel}</strong>, `
      + `${params.stackBB}bb, ${positionLabel} — ${raiseWord} <strong>${stats.totalPct.toFixed(1)}%</strong> of hands.</div>`
    );

    const breakdown = [
      `${stats.valuePct.toFixed(1)}% value`,
      stats.speculativePct > 0 ? `${stats.speculativePct.toFixed(1)}% implied-odds speculative hands` : null,
      `${stats.bluffPct.toFixed(1)}% bluffs`,
    ].filter(Boolean).join(', ');
    parts.push(`<div class="solver-summary-line">${breakdown}. Bluffs land at <strong>${stats.achievedBluffFreq.toFixed(0)}%</strong> of the raising range (target ${params.bluffFreq}%).</div>`);

    const notes = [];
    if (shortStack) notes.push('Stack under 20bb — fold equity dominates, so this collapses to a push/fold chart.');
    if (params.gameType === 'tournament') notes.push('Tournament ICM trims a few marginal value hands versus the same spot in cash.');
    if (!shortStack && params.stackBB > 40) notes.push('Deep stack — suited connectors and small pairs get added for their implied odds.');
    if (params.bluffFreq === 0) notes.push('Bluff frequency at 0% — this is a pure value range.');
    if (notes.length) {
      parts.push(`<div class="solver-summary-notes">${notes.map((n) => `<div>• ${n}</div>`).join('')}</div>`);
    }

    document.getElementById('solver-summary').innerHTML = parts.join('');
  },
};

# AllInBots

Texas Hold'em against AI opponents, in the browser. No sign-up, no backend, no real money — just chips and nerve.

## Play

Open [index.html](index.html) in a browser, or serve the folder locally:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Modes

- **Cash Game** — fixed blinds, rebuy anytime you bust.
- **Tournament** — blinds rise every 4 hands, no rebuys, last stack standing wins.

## Table types

- **You + Bots** — you against 2-5 AI opponents.
- **Bots Only** — sit back and spectate as 2-6 bots play each other; hands auto-deal.
- **Humans Only** — local pass-and-play for 2-6 people on one device. Each player's hole
  cards stay hidden behind a "pass the device" screen until it's their turn to act.

## How the bots think

Each bot has a personality (aggression, tightness, bluff frequency) layered on top of a hand-strength
estimate: the Chen formula preflop, and a Monte Carlo equity simulation against the remaining live
opponents postflop. Decisions weigh that estimate against pot odds before folding, calling, or sizing
a raise.

## Project structure

```
index.html          Screens and layout
css/styles.css       Table, cards, and UI styling
js/deck.js           Cards and shuffling
js/handEvaluator.js  7-card best-hand evaluation
js/bot.js            Bot equity estimation and decision making
js/game.js           Betting rounds, side pots, hand/tournament state machine
js/ui.js             DOM rendering
js/app.js            Wires the engine to the screens
```

No build step, no dependencies — plain HTML/CSS/JS.

# AllInBots

Texas Hold'em against AI opponents — or against friends online — in the browser. No sign-up, no real money — just chips and nerve.

## Play

**You + Bots** and **Bots Only** need no backend at all — just open [index.html](index.html) directly, or serve the folder locally:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

**Humans Only** (online multiplayer) needs the WebSocket server running, since that's what lets
players on separate devices/browsers share a table — see [Online multiplayer](#online-multiplayer) below.

## Modes

- **Cash Game** — fixed blinds, rebuy anytime you bust.
- **Tournament** — blinds rise every 4 hands, no rebuys, last stack standing wins.

## Table types

- **You + Bots** — you against 2-5 AI opponents, in your own browser.
- **Bots Only** — sit back and spectate as 2-6 bots play each other; hands auto-deal.
- **Humans Only** — real online multiplayer. One player creates a room and shares its code or
  link; everyone else joins from their own device/browser over the network. The server never
  sends a player anyone else's hole cards. Empty seats can optionally be filled with bots.

## Online multiplayer

The `server/` folder is a small Node WebSocket server that both serves the site and hosts game
rooms. It needs a real, persistently-running host (Render, Fly, Railway, a VPS, etc.) — static
hosting like GitHub Pages can serve the page but can't provide the WebSocket side.

```bash
cd server
npm install
npm start        # or: PORT=3000 npm start
```

Then open the printed URL, pick **Humans Only**, and create or join a room. The create/join
panel builds a shareable link automatically (`?room=CODE`) — opening it prefills the room code.

The server reuses the same game engine as the local modes (`js/deck.js`, `js/handEvaluator.js`,
`js/bot.js`, `js/game.js`) unmodified; see `server/engine.js`.

## Preflop solver

A standalone "Preflop Solver" button on the lobby screen opens a live 13x13 starting-hand range
grid. Unlike a static GTO chart, every cell is recomputed on the spot from four inputs:

- **Players at the table** (2-9) and **position** — sets how wide the opening range is via a
  hand-strength percentile cutoff (the same Chen-formula estimate the bots use).
- **Cash game vs. tournament** — tournament mode applies a simplified ICM factor that trims
  marginal value hands as the stack gets shorter, since chips are worth less than face value
  once survival matters.
- **Stack size** — deep stacks (40bb+) pull in speculative hands (suited connectors, small
  pairs) for their implied odds; short stacks (under 20bb) collapse the chart into a push/fold
  shove range, since fold equity dominates raw hand strength.
- **Bluff frequency** — a direct dial, not a fixed GTO ratio. Set a target percentage and the
  solver fills your raising range with that many bluff combos, picked by blocker value (Ax/Kx)
  and backdoor equity (suited connectors) rather than randomly.

It's a heuristic teaching tool (percentile cutoffs, implied-odds heuristics, a simplified ICM
factor) rather than a full game-tree solve — built for showing *directionally* how a range
should change with table context, not for exact equilibrium frequencies. See `js/solver.js` for
the computation and `js/solverScreen.js` for the grid rendering.

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
js/solver.js         Preflop range computation (pure, no DOM)
js/game.js           Betting rounds, side pots, hand/tournament state machine
js/ui.js             DOM rendering
js/net.js            WebSocket client wrapper for online play
js/app.js            Wires the engine to the screens (local table types)
js/online.js         Lobby + online table screen wiring (networked table type)
js/solverScreen.js   Solver screen controls + range grid rendering
server/server.js     Static file server + WebSocket endpoint
server/room.js        One online table: lobby, authoritative game, per-viewer snapshots
server/engine.js      Loads the browser engine files for reuse on the server
```

No build step for the client — plain HTML/CSS/JS. The server is a small Node app with one
dependency (`ws`).

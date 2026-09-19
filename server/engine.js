// Loads the browser-authored game engine (js/deck.js, js/handEvaluator.js,
// js/bot.js, js/game.js) for reuse on the server, unmodified. Those files are
// plain scripts written as globals (no build step, per the project's design),
// so each one's exports are attached to `global` before the next is required
// — the same way <script> tags line them up in index.html. Only function/class
// *definitions* happen at require time; the deck/hand-evaluator helpers they
// call are only touched once a hand is actually played, by which point every
// global below is already in place.
const path = require('path');

const jsDir = path.join(__dirname, '..', 'js');

Object.assign(global, require(path.join(jsDir, 'deck.js')));
Object.assign(global, require(path.join(jsDir, 'handEvaluator.js')));
Object.assign(global, require(path.join(jsDir, 'bot.js')));
const { PokerGame } = require(path.join(jsDir, 'game.js'));

module.exports = {
  PokerGame,
  BOT_PERSONALITIES: global.BOT_PERSONALITIES,
  decideBotAction: global.decideBotAction,
};

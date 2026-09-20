// Thin WebSocket client for online multiplayer rooms. Talks to server/server.js.

const Net = {
  ws: null,
  connected: false,
  handlers: {},

  connect() {
    return new Promise((resolve, reject) => {
      if (this.ws && this.connected) {
        resolve();
        return;
      }
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      let settled = false;
      this.ws = ws;

      ws.addEventListener('open', () => {
        this.connected = true;
        settled = true;
        resolve();
      });
      ws.addEventListener('error', () => {
        if (!settled) {
          settled = true;
          reject(new Error('Could not connect to the game server.'));
        }
      });
      ws.addEventListener('close', () => {
        this.connected = false;
        this.emit('disconnected', {});
      });
      ws.addEventListener('message', (evt) => {
        let msg;
        try {
          msg = JSON.parse(evt.data);
        } catch {
          return;
        }
        this.emit(msg.type, msg);
      });
    });
  },

  send(msg) {
    if (this.ws && this.connected) this.ws.send(JSON.stringify(msg));
  },

  on(type, fn) {
    this.handlers[type] = fn;
  },

  emit(type, msg) {
    const fn = this.handlers[type];
    if (fn) fn(msg);
  },
};

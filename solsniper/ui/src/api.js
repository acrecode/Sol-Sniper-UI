/* Thin API client. Talks to the Fastify backend through the Vite dev proxy
   (/api -> :8787, /ws -> ws://:8787/ws). */

const base = '/api';

async function j(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).error || '';
    } catch {
      /* ignore */
    }
    throw new Error(detail || `${method} ${path} -> ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  getState: () => j('GET', '/state'),
  getConfig: () => j('GET', '/config'),
  putConfig: (cfg) => j('PUT', '/config', cfg),
  presets: () => j('GET', '/presets'),
  preset: (name) => j('GET', '/presets/' + encodeURIComponent(name)),
  positions: () => j('GET', '/positions'),
  ledger: (limit = 50) => j('GET', '/ledger?limit=' + limit),
  start: () => j('POST', '/control/start'),
  stop: () => j('POST', '/control/stop'),
  kill: () => j('POST', '/control/kill'),
  flush: () => j('POST', '/control/flush'),
  loadWallet: (secret) => j('POST', '/wallet', { secret }),
  sellPosition: (id) => j('POST', `/positions/${id}/sell`),
};

/** Open the live event websocket. onEvent receives {type, ts, data}. */
export function openWs(onEvent, onOpen, onClose) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => onOpen && onOpen();
  ws.onclose = () => onClose && onClose();
  ws.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      /* ignore */
    }
  };
  return ws;
}

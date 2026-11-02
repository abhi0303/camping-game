// Local stand-in for Neon's WebSocket endpoint, so `wrangler dev` can run the real Neon driver
// against a plain local Postgres. Testing only; it only connects to this computer.
//   node scripts/local-wsproxy.mjs 8899     then set NEON_LOCAL_WSPROXY=127.0.0.1:8899/v1 in .dev.vars
import net from 'node:net';
import { WebSocketServer } from 'ws';

const port = Number(process.argv[2] || 8899);
const wss = new WebSocketServer({ port, host: '127.0.0.1' });
wss.on('connection', (ws, req) => {
  const addr = new URL(req.url, 'http://x').searchParams.get('address') || '';
  const [host, p] = addr.split(':');
  if (!['127.0.0.1', 'localhost'].includes(host)) { ws.close(1008, 'local only'); return; }
  const tcp = net.connect(Number(p || 5432), '127.0.0.1');
  const queued = [];
  tcp.on('connect', () => { for (const b of queued.splice(0)) tcp.write(b); });
  ws.on('message', d => { if (tcp.readyState === 'open') tcp.write(d); else queued.push(d); });
  tcp.on('data', d => { if (ws.readyState === 1) ws.send(d); });
  const end = () => { try { tcp.destroy(); } catch (e) { /* ignore */ } try { ws.close(); } catch (e) { /* ignore */ } };
  ws.on('close', end); ws.on('error', end); tcp.on('close', end); tcp.on('error', end);
});
console.log(`local Neon WebSocket relay on ws://127.0.0.1:${port}/v1`);

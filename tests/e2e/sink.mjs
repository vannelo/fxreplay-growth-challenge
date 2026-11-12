/**
 * Stand-in for PostHog's capture API. Records every event the app sends, from the browser (/batch/) and the server
 * (/i/v0/e/), so tests can assert on the DATA that actually left, not on the code that tried to send it.
 *   GET    /__events[?distinct_id=...]  → recorded events, in arrival order
 *   DELETE /__events                    → clear
 */
import { createServer } from 'node:http';

const events = [];
let seq = 0;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS', 'Access-Control-Allow-Headers': '*' };

createServer((req, res) => {
  const url = new URL(req.url, 'http://sink');
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  if (url.pathname === '/__events') {
    if (req.method === 'DELETE') {
      events.length = 0;
      return res.writeHead(204, cors).end();
    }
    const id = url.searchParams.get('distinct_id');
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(id ? events.filter((e) => e.distinct_id === id) : events));
  }
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    try {
      const body = JSON.parse(raw);
      const list = url.pathname === '/batch/' ? (body.batch ?? []).map((e) => ({ ...e, api_key: body.api_key })) : [body];
      for (const e of list) events.push({ seq: ++seq, endpoint: url.pathname, ...e });
    } catch {
      events.push({ seq: ++seq, endpoint: url.pathname, invalid: raw.slice(0, 200) });
    }
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end('{"status":1}');
  });
}).listen(Number(process.env.SINK_PORT ?? 4410), '127.0.0.1', () => console.log('capture sink listening'));

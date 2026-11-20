// k6 load test for POST /v1/agent/events.
//
//   k6 run -e API=http://localhost:4000 -e DEVICES=20 -e BATCH=100 -e DURATION=60s apps/api/load/ingest.k6.js
//
// setup(): creates DEVICES users, each with one paired device and an open 1-day audit.
// Each VU uploads batches of BATCH fresh app_focus events (unique ids, timestamps "now")
// with its own device token; every ~10th request replays a previous batch to exercise the
// idempotent path. Run the API with INGEST_RATE_CAPACITY / USER_DAILY_EVENT_QUOTA raised to
// measure raw throughput (see RESULTS.md); with defaults you will see the 429s by design.
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const API = __ENV.API || 'http://localhost:4000';
const DEVICES = Number(__ENV.DEVICES || 20);
const BATCH = Number(__ENV.BATCH || 100);

export const options = {
  setupTimeout: '120s',
  scenarios: {
    ingest: {
      executor: 'constant-vus',
      vus: DEVICES,
      duration: __ENV.DURATION || '60s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:ingest}': ['p(95)<500'],
  },
};

const accepted = new Counter('events_accepted');
const replays = new Counter('batches_replayed');
const batchLatency = new Trend('ingest_batch_ms', true);

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const json = { headers: { 'content-type': 'application/json' } };

// One user per device, as in production (each user's ingests are serialized by design).
export function setup() {
  const tokens = [];
  for (let i = 0; i < DEVICES; i++) {
    const email = `load-${uuid()}@example.com`;
    const s = http.post(`${API}/v1/auth/signup`, JSON.stringify({ email, password: 'load test password 123', acceptSelfObservation: true }), json);
    check(s, { 'signup 201': (r) => r.status === 201 });
    const auth = { headers: { 'content-type': 'application/json', authorization: `Bearer ${s.json('accessToken')}` } };
    const code = http.post(`${API}/v1/devices/pairing-codes`, null, auth).json('code');
    const p = http.post(`${API}/v1/devices/pair`, JSON.stringify({ code, deviceName: `load-${i}`, platform: 'simulated', agentVersion: 'k6' }), json);
    check(p, { 'pair 201': (r) => r.status === 201 });
    const a = http.post(`${API}/v1/audits`, JSON.stringify({ lengthDays: 1 }), auth);
    check(a, { 'audit 201': (r) => r.status === 201 });
    tokens.push(p.json('deviceToken'));
  }
  return { tokens };
}

const apps = [
  ['excel', 'Q3 numbers.xlsx', null],
  ['google-sheets', 'Revenue - Google Sheets', 'docs.google.com'],
  ['gmail', 'Inbox', 'mail.google.com'],
  ['slack', 'general', null],
];
let seq = 0;
let lastBody = null;

export default function (data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const params = { headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, tags: { name: 'ingest' } };
  let body;
  const replay = lastBody && __ITER % 10 === 9;
  if (replay) body = lastBody;
  else {
    const now = Date.now();
    const events = [];
    for (let i = 0; i < BATCH; i++) {
      const [key, title, host] = apps[(seq + i) % apps.length];
      events.push({
        id: uuid(),
        ts: new Date(now - (BATCH - i) * 10).toISOString(),
        seq: seq++,
        schemaVersion: 1,
        redactions: {},
        kind: 'app_focus',
        app: { key, name: key },
        windowTitle: title,
        urlHost: host,
      });
    }
    body = JSON.stringify({ batchId: uuid(), sentAt: new Date(now).toISOString(), agentVersion: 'k6', platform: 'simulated', events });
    lastBody = body;
  }
  const r = http.post(`${API}/v1/agent/events`, body, params);
  batchLatency.add(r.timings.duration);
  const ok = check(r, { 'ingest 202': (x) => x.status === 202 });
  if (ok && replay) replays.add(1);
  else if (ok) accepted.add(r.json('accepted'));
}

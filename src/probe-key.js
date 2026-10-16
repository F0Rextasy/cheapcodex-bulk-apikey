'use strict';
/**
 * cheapcodex probe-key — measure the two relay gates seen live:
 *   1) "API Key is not assigned to any group" (key needs group_id)
 *   2) "INSUFFICIENT_BALANCE" (account-level balance gate)
 *
 * Logs in, optionally creates a new key bound to a group, then probes
 * /v1/usage, /v1/models and a few chat model names.
 *
 *   node src/probe-key.js --accounts out/accounts-test.json --n 1 --group 2 --proxy-file out/pool.txt
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

let createAgent = null;
let parseProxy = null;
try {
  ({ createAgent, parseProxy } = require('./proxy.js'));
} catch (e) {}

const GATEWAY = 'https://api.cheapcodex.online';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[a.slice(2)] = true;
      else args[a.slice(2)] = argv[++i];
    } else args._.push(a);
  }
  return args;
}

function rawRequest(url, { method = 'GET', headers = {}, body, proxy = null, timeoutMs = 45000 } = {}) {
  const parsedProxy = typeof proxy === 'string' && parseProxy ? parseProxy(proxy) : proxy;
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = https.request(
      {
        method,
        host: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        agent: proxy && createAgent ? createAgent(parsedProxy) : undefined,
        headers: {
          Accept: 'application/json',
          'User-Agent': UA,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (e) {}
          resolve({ status: res.statusCode, json, text });
        });
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const isNet = (m) => /SOCKS|CONNECT|timeout|ECONN|ETIMEDOUT|EAI_AGAIN|socket|TLS|certificate|expired/i.test(String(m));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ROOT = path.resolve(__dirname, '..'); // data root (the repo root)
const accFile = String(args.accounts || path.join(ROOT, 'out', 'accounts-test.json'));
  const n = parseInt(args.n || '1', 10);
  const pool = args['proxy-file']
    ? fs.readFileSync(String(args['proxy-file']), 'utf8').split(/\r?\n/).map((l) => l.split('#')[0].trim()).filter(Boolean).filter((l) => !/127\.0\.0\.1/.test(l))
    : [];
  let cursor = 0;
  const next = () => (pool.length ? pool[cursor++ % pool.length] : null);
  const call = async (url, opts = {}) => {
    let last = null;
    for (let i = 0; i < 8; i++) {
      try {
        return await rawRequest(url, { ...opts, proxy: next() });
      } catch (e) {
        last = e;
        if (isNet(e.message)) continue;
        throw e;
      }
    }
    throw last;
  };

  const accounts = JSON.parse(fs.readFileSync(accFile, 'utf8')).accounts;
  const acc = accounts[Math.min(n - 1, accounts.length - 1)];
  const H = (t) => ({ 'X-User-UI-Request': '1', ...(t ? { Authorization: `Bearer ${t}` } : {}) });
  const login = await call(`${GATEWAY}/api/v1/auth/login`, { method: 'POST', headers: H(), body: { email: acc.email, password: acc.password } });
  const token = ((login.json || {}).data || {}).access_token;
  console.log(`login ${login.status} ${token ? 'ok' : JSON.stringify(login.json).slice(0, 120)}`);
  if (!token) return;

  let key = acc.key;
  if (args.group) {
    const res = await call(`${GATEWAY}/api/v1/keys`, {
      method: 'POST',
      headers: H(token),
      body: { name: `group-${args.group}-probe`, group_id: parseInt(args.group, 10), status: 'active' },
    });
    console.log(`key+group ${args.group}: ${res.status} ${JSON.stringify(res.json).slice(0, 300)}`);
    const k = ((res.json || {}).data || {}).key;
    if (k) key = k;
  }
  if (!key) {
    console.log('no key available');
    return;
  }
  console.log(`key ${key.slice(0, 16)}…`);

  for (const [label, url] of [
    ['v1/usage', `${GATEWAY}/v1/usage`],
    ['v1/models', `${GATEWAY}/v1/models`],
  ]) {
    try {
      const r = await call(url, { headers: { Authorization: `Bearer ${key}` } });
      console.log(`\n=== ${label} (${r.status})\n${(r.text || '').slice(0, 600)}`);
    } catch (e) {
      console.log(`\n=== ${label} ✘ ${e.message}`);
    }
  }

  const models = String(args.models || 'gpt-6-astra,gpt-5.5,gpt-5.1-mini,deepseek-v3.2,gpt-4o-mini').split(',');
  for (const model of models) {
    try {
      const r = await call(`${GATEWAY}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: { model, messages: [{ role: 'user', content: 'Reply with exactly: ok' }], max_tokens: 8, stream: false },
      });
      const ok = r.status === 200 && r.json && r.json.choices;
      console.log(`chat ${model}: ${r.status} ${ok ? '✔ ' + JSON.stringify(r.json.choices[0].message.content).slice(0, 60) : (r.text || '').slice(0, 200)}`);
    } catch (e) {
      console.log(`chat ${model} ✘ ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error('[fatal]', e.message);
  process.exit(1);
});

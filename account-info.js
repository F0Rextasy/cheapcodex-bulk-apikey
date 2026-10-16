'use strict';
/**
 * cheapcodex account-info — log in with an account from accounts.json and dump the
 * user-side surfaces (me, subsidy, groups, keys, /v1/usage) so the funding path and
 * the 403 INSUFFICIENT_BALANCE gate can be read directly.
 *
 *   node account-info.js --accounts out/accounts-test.json --proxy-file out/pool.txt [--n 1]
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

const isNet = (m) => /SOCKS|CONNECT|timeout|ECONN|ETIMEDOUT|EAI_AGAIN|socket|TLS|certificate/i.test(String(m));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const accFile = String(args.accounts || path.join(__dirname, 'out', 'accounts-test.json'));
  const n = parseInt(args.n || '1', 10);
  const pool = args['proxy-file']
    ? fs.readFileSync(String(args['proxy-file']), 'utf8').split(/\r?\n/).map((l) => l.split('#')[0].trim()).filter(Boolean).filter((l) => !/127\.0\.0\.1/.test(l))
    : [];
  let cursor = 0;
  const next = () => (pool.length ? pool[cursor++ % pool.length] : null);

  const accounts = JSON.parse(fs.readFileSync(accFile, 'utf8')).accounts;
  const acc = accounts[Math.min(n - 1, accounts.length - 1)];
  console.log(`account ${acc.email} key ${acc.key ? acc.key.slice(0, 12) : '(none)'}…`);

  const call = async (url, opts = {}) => {
    for (let i = 0; i < 6; i++) {
      const proxy = next();
      try {
        return await rawRequest(url, { ...opts, proxy });
      } catch (e) {
        if (isNet(e.message) && i < 5) continue;
        throw e;
      }
    }
  };

  const H = (t) => ({ 'X-User-UI-Request': '1', ...(t ? { Authorization: `Bearer ${t}` } : {}) });

  const login = await call(`${GATEWAY}/api/v1/auth/login`, { method: 'POST', headers: H(), body: { email: acc.email, password: acc.password } });
  const token = ((login.json || {}).data || {}).access_token;
  console.log(`login ${login.status} token ${token ? 'ok' : JSON.stringify(login.json).slice(0, 140)}`);
  if (!token) return;

  for (const [label, url, opts] of [
    ['me', `/api/v1/auth/me`, {}],
    ['creator-subsidy', `/api/v1/user/creator-subsidy`, {}],
    ['platform-quotas', `/api/v1/user/platform-quotas`, {}],
    ['creator-subsidy/campaign', `/api/v1/user/creator-subsidy/campaign`, {}],
    ['groups/available', `/api/v1/groups/available`, {}],
    ['groups/rates', `/api/v1/groups/rates`, {}],
    ['channels/available', `/api/v1/channels/available`, {}],
    ['keys', `/api/v1/keys`, {}],
    ['user/aff', `/api/v1/user/aff`, {}],
    ['announcements', `/api/v1/announcements`, {}],
  ]) {
    try {
      const r = await call(`${GATEWAY}${url}`, { ...opts, headers: H(token) });
      console.log(`\n=== ${label} (${r.status})\n${JSON.stringify(r.json, null, 1).slice(0, 1800)}`);
    } catch (e) {
      console.log(`\n=== ${label} ✘ ${e.message}`);
    }
  }

  // relay-side: does the key itself work at all? (/v1/usage + a chat attempt)
  if (acc.key) {
    for (const [label, url, opts] of [
      ['v1/usage', `/v1/usage`, {}],
      ['v1/models', `/v1/models`, {}],
    ]) {
      try {
        const r = await call(`${GATEWAY}${url}`, { ...opts, headers: { Authorization: `Bearer ${acc.key}` } });
        console.log(`\n=== ${label} (${r.status})\n${JSON.stringify(r.json, null, 1).slice(0, 700)}`);
      } catch (e) {
        console.log(`\n=== ${label} ✘ ${e.message}`);
      }
    }
    try {
      const r = await call(`${GATEWAY}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${acc.key}` },
        body: { model: String(args.model || 'gpt-5.1-mini'), messages: [{ role: 'user', content: 'say ok' }], max_tokens: 8 },
      });
      console.log(`\n=== v1/chat/completions (${r.status})\n${(r.text || '').slice(0, 500)}`);
    } catch (e) {
      console.log(`\n=== v1/chat ✘ ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error('[fatal]', e.message);
  process.exit(1);
});

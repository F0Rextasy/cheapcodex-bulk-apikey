'use strict';
/**
 * cheapcodex-mint — create cheapcodex accounts (sub2api panel) and one API key each.
 *
 * The panel is NOT New API: `GET /api/v1/settings/public` (unauthenticated) is its
 * self-describing gate snapshot. Measured live 2026-10-14:
 *   registration_enabled:true · email_verify_enabled:true · turnstile_enabled:false
 *   registration_email_suffix_whitelist: ["@qq.com","@gmail.com"]
 *   invitation_code_enabled:false · promo_code_enabled:false
 * → the signup e-mail must be a REAL @gmail.com or @qq.com box. Mailtrap is refused
 *   ("EMAIL_SUFFIX_NOT_ALLOWED"), so mailboxes come from Emailnator (public gmail
 *   pool; a dotted address and its dot-free twin share one inbox).
 *
 * Flow per account: generate gmail → POST /api/v1/auth/send-verify-code → read the
 * 6-char code from Emailnator → POST /api/v1/auth/register (returns JWT pair) →
 * POST /api/v1/keys → POST /api/v1/user/creator-subsidy/check-in (daily credit) →
 * verify the key with /v1/models + a mini chat completion. Keys are appended to
 * keys.txt the moment they verify.
 *
 * Usage:
 *   node src/mint.js --count 30 --out keys.txt [--proxy-file ../../out/pool.txt] [--workers 3]
 *   node src/mint.js --count 1  --proxy socks5://127.0.0.1:40000
 *   node src/mint.js --verify-only keys.txt
 */
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { URL } = require('url');

let createAgent = null;
let parseProxy = null;
try {
  ({ createAgent, parseProxy } = require('./proxy.js'));
} catch (e) {
  /* proxy support is optional at runtime */
}

const GATEWAY = 'https://api.cheapcodex.online';
const EMAILNATOR = 'https://www.emailnator.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const UI_HEADER = { 'X-User-UI-Request': '1' };
const AFF_CODE = 'U7SSQZSDB36S'; // invite code from the pool report (affiliate code field)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** Minimal request helper: https, optional CONNECT proxy, JSON in/out. */
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
          resolve({ status: res.statusCode, json, text, headers: res.headers });
        });
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Free exits die between the health probe and the real call, so every request
// retries itself through the next pool line instead of failing the account.
let PROXY_POOL = [];
let POOL_CURSOR = 0;
const isNetworkError = (msg) => /SOCKS|CONNECT|timeout|hang up|ECONN|ETIMEDOUT|EAI_AGAIN|socket|certificate|TLS|self.signed/i.test(String(msg));

function nextPoolLine() {
  if (!PROXY_POOL.length) return null;
  return PROXY_POOL[POOL_CURSOR++ % PROXY_POOL.length];
}

let REQ_TIMEOUT_MS = 45000;
let REQ_RETRIES = 3;

function request(url, opts = {}) {
  const { retries = REQ_RETRIES } = opts;
  const proxy = opts.proxy !== undefined && opts.proxy !== null ? opts.proxy : nextPoolLine();
  return rawRequest(url, { timeoutMs: REQ_TIMEOUT_MS, ...opts, proxy }).catch((e) => {
    if (retries > 0 && isNetworkError(e.message) && PROXY_POOL.length) {
      return request(url, { ...opts, proxy: nextPoolLine(), retries: retries - 1 });
    }
    throw e;
  });
}

const emailnatorHeaders = { origin: EMAILNATOR, referer: `${EMAILNATOR}/` };

// Emailnator is a shared public service (429s observed while other agents use it too).
// NB: a pacing gate must never stay rejected — after one failure a chained `.then` on a
// rejected promise replays the stale error to every later caller (measured: 44 attempts
// died in seconds with one proxy's timeout message). The gate keeps a swallow-copy.
let MAIL_GATE = Promise.resolve();
let LAST_MAIL = 0;
const MAIL_GAP_MS = { v: 6000 };
function mailRequest(url, opts = {}) {
  const wait = Math.max(0, LAST_MAIL + MAIL_GAP_MS.v - Date.now());
  const run = MAIL_GATE.then(() => new Promise((r) => setTimeout(r, wait))).then(() =>
    request(url, opts).then((res) => {
      LAST_MAIL = Date.now();
      return res;
    })
  );
  MAIL_GATE = run.catch(() => {});
  return run.catch(async (e) => {
    if (/429/.test(String(e.message))) {
      await sleep(30000);
      return request(url, opts);
    }
    throw e;
  });
}

/** A dotted gmail address from Emailnator, plus its dot-free twin. */
async function newGmail(proxy) {
  const res = await mailRequest(`${EMAILNATOR}/api/generate-email`, {
    method: 'POST',
    headers: emailnatorHeaders,
    body: { ids: [3] },
    proxy,
  });
  const dotted = res.json && res.json.email;
  if (!dotted || !/@gmail\.com$/i.test(dotted)) throw new Error(`emailnator returned ${res.status}: ${res.text.slice(0, 120)}`);
  const [local, domain] = dotted.split('@');
  return { dotted, plain: `${local.replace(/\./g, '')}@${domain}` };
}

/** Poll Emailnator for the cheapcodex verification code. */
async function waitForCode(plain, { timeoutMs = 240000, pollMs = 8000, proxy = null, log = () => {} } = {}) {
  const deadline = Date.now() + timeoutMs;
  const seen = new Set();
  while (Date.now() < deadline) {
    const list = await mailRequest(`${EMAILNATOR}/api/message-list`, {
      method: 'POST',
      headers: emailnatorHeaders,
      body: { email: plain, limit: 20 },
      proxy,
    });
    const messages = (list.json && list.json.messages) || [];
    for (const m of messages) {
      const id = String(m.id);
      if (seen.has(id)) continue;
      seen.add(id);
      if (!/cheap/i.test(String(m.from || ''))) continue;
      const full = await mailRequest(`${EMAILNATOR}/api/message/${encodeURIComponent(id)}`, { headers: emailnatorHeaders, proxy });
      const raw = String((full.json && full.json.content) || '');
      const content = raw.replace(/<[^>]+>/g, ' ');
      log(`      mail: "${String(m.from).slice(0, 60)}" · ${content.replace(/\s+/g, ' ').trim().slice(0, 200)}`);
      const code =
        /\b([A-Z0-9]{6})\b/.exec(content)?.[1] || // sub2api code style
        /\b([0-9]{6})\b/.exec(content)?.[1] ||
        /code[^A-Z0-9]{0,12}([A-Za-z0-9]{4,8})/i.exec(content)?.[1];
      if (code) return code;
    }
    await sleep(pollMs);
  }
  throw new Error('no verification code arrived');
}

/** The signup gate only accepts the well-known mailbox providers (QQ/Gmail). */
const SEND_GAP_MS = { v: 20000 };
let SEND_GATE = Promise.resolve();
let LAST_SEND = 0;
const pacedSend = (fn) => {
  const wait = Math.max(0, LAST_SEND + SEND_GAP_MS.v - Date.now());
  const run = SEND_GATE.then(() => new Promise((r) => setTimeout(r, wait))).then(async () => {
    LAST_SEND = Date.now();
    return fn();
  });
  SEND_GATE = run.catch(() => {}); // same rule as MAIL_GATE: never leave the gate rejected
  return run;
};

async function sendVerifyCode(email, proxy, log = () => {}) {
  for (let tryN = 1; tryN <= 3; tryN++) {
    const res = await pacedSend(() =>
      request(`${GATEWAY}/api/v1/auth/send-verify-code`, { method: 'POST', headers: UI_HEADER, body: { email }, proxy })
    );
    const j = res.json || {};
    if (res.status === 200 && (j.code === undefined || j.code === 0)) return true;
    const reason = `${j.reason || j.message || res.status}`;
    const err = new Error(`send-verify-code refused: ${reason}`);
    err.body = j;
    err.rateLimited = /too many|frequent|rate/i.test(reason) || res.status === 429;
    if (err.rateLimited && tryN < 3) {
      const wait = 45000 * tryN;
      log(`send-verify-code rate-limited — waiting ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    throw err;
  }
}

/** Register auto-returns the JWT pair (the SPA stores it straight away). */
async function register({ email, password, code, affCode }, proxy) {
  const res = await request(`${GATEWAY}/api/v1/auth/register`, {
    method: 'POST',
    headers: UI_HEADER,
    proxy,
    body: {
      email,
      password,
      verify_code: code,
      ...(affCode ? { aff_code: affCode } : {}),
    },
  });
  const j = res.json || {};
  const d = j.data || {};
  if (!d.access_token) throw new Error(`register failed: ${res.status} ${JSON.stringify(j).slice(0, 200)}`);
  return d; // {access_token, refresh_token, expires_in, user}
}

async function login({ email, password }, proxy) {
  const res = await request(`${GATEWAY}/api/v1/auth/login`, {
    method: 'POST',
    headers: UI_HEADER,
    proxy,
    body: { email, password },
  });
  const d = (res.json && res.json.data) || {};
  if (!d.access_token) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.json || {}).slice(0, 160)}`);
  return d;
}

const authHeaders = (token) => ({ ...UI_HEADER, Authorization: `Bearer ${token}` });

async function createKey({ token, name, groupId }, proxy) {
  const res = await request(`${GATEWAY}/api/v1/keys`, {
    method: 'POST',
    headers: authHeaders(token),
    proxy,
    body: { name, group_id: groupId ?? null, status: 'active', use_custom_key: false, custom_key: '', enable_ip_restriction: false, ip_whitelist: [], ip_blacklist: [], enable_quota: false, quota: null, enable_rate_limit: false, rate_limit_5h: null, rate_limit_1d: null, rate_limit_7d: null, enable_expiration: false },
  });
  const j = res.json || {};
  const d = j.data || {};
  const key = d.key || d.api_key || d.key_string || d.token;
  if (!key) throw new Error(`key create failed: ${res.status} ${JSON.stringify(j).slice(0, 220)}`);
  return { key, id: d.id, raw: d };
}

const getKeys = async (token, proxy) => {
  const res = await request(`${GATEWAY}/api/v1/keys`, { headers: authHeaders(token), proxy });
  const d = (res.json && res.json.data) || {};
  return d.keys || d.items || d.list || (Array.isArray(d) ? d : []);
};

const getMe = async (token, proxy) => {
  const res = await request(`${GATEWAY}/api/v1/auth/me`, { headers: authHeaders(token), proxy });
  return (res.json && res.json.data) || {};
};

const getSubsidy = async (token, proxy) => {
  const res = await request(`${GATEWAY}/api/v1/user/creator-subsidy`, { headers: authHeaders(token), proxy });
  return (res.json && res.json.data) || {};
};

const checkIn = async (token, proxy) => {
  const res = await request(`${GATEWAY}/api/v1/user/creator-subsidy/check-in`, { method: 'POST', headers: authHeaders(token), proxy, body: {} });
  return { status: res.status, json: res.json };
};

/**
 * Live verification in two stages, because the provider has an account-level gate:
 *   1. /v1/usage — proves the key authenticates and is assigned to a group (200).
 *   2. a real completion — proves the account can serve traffic. While the
 *      "百亿补贴" campaign is paused (announcement 2026-09-02) every fresh account
 *      answers 403 INSUFFICIENT_BALANCE; that is the provider-wide gate, recorded
 *      as `completion.status`, not as a key defect.
 */
async function verify(key, proxy, { log = () => {} } = {}) {
  const usage = await request(`${GATEWAY}/v1/usage`, { headers: { Authorization: `Bearer ${key}` }, proxy });
  const usageOk = usage.status === 200 && !!(usage.json && usage.json.isValid);
  if (!usageOk) return { ok: false, usage_status: usage.status, text: usage.text.slice(0, 160) };

  const models = await request(`${GATEWAY}/v1/models`, { headers: { Authorization: `Bearer ${key}` }, proxy });
  const ids = (((models.json || {}).data) || []).map((m) => m.id);
  const pick =
    ids.find((id) => /gpt-5\.1-mini|gpt-5-mini|gpt-4o-mini|gpt-4\.1-mini/i.test(id)) ||
    ids.find((id) => /mini|flash|haiku|deepseek/i.test(id)) ||
    ids.find((id) => /^gpt/i.test(id)) ||
    ids[0] ||
    'gpt-5.1-mini';
  const chat = await request(`${GATEWAY}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    proxy,
    body: { model: pick, messages: [{ role: 'user', content: 'Reply with exactly: ok' }], max_tokens: 8, stream: false },
  });
  const completionOk = chat.status === 200 && !!(chat.json && chat.json.choices && chat.json.choices.length);
  const gate = (chat.json && chat.json.code) || (models.json && models.json.code) || null;
  const balanceGate = gate === 'INSUFFICIENT_BALANCE';
  log(
    `      usage 200 (balance ${(usage.json || {}).balance}) · models ${models.status} · completion ${completionOk ? '✔ ' + pick : `${chat.status} ${gate || ''}`}`
  );
  return {
    ok: usageOk && (completionOk || balanceGate),
    live: usageOk,
    usage_status: usage.status,
    balance: (usage.json || {}).balance,
    models_status: models.status,
    models: ids.length,
    model: completionOk ? pick : null,
    completion_status: chat.status,
    gate,
    note: balanceGate ? 'key valid & group-assigned; corpus gated by account balance (campaign paused)' : undefined,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h || (!args.count && !args['verify-only'] && !args['keys-only'])) {
    console.log(`cheapcodex-mint — one API key per fresh account

  node src/mint.js --count N --out keys.txt [--proxy-file pool.txt --workers 3] [--delay 4000]
  node src/mint.js --count 1 --proxy socks5://127.0.0.1:40000   # single exit (WARP)
  node src/mint.js --verify-only keys.txt [--proxy-file pool.txt]

  Gates (live 2026-10-14): registration open, e-mail verification on, Turnstile OFF,
  signup suffix whitelist = @qq.com/@gmail.com → Emailnator gmail boxes are the only
  free mail path. Agency: one key per account; quota lives on the account.
`);
    return;
  }
  const count = parseInt(args.count || '30', 10);
  const out = String(args.out || 'keys.txt');
  const accountsOut = String(args.accounts || out.replace(/\.txt$/, '') + '.accounts.json');
  const delay = parseInt(args.delay || '4000', 10);
  const namePrefix = String(args['name-prefix'] || 'ccx-bulk');
  const groupId = args.group !== undefined ? parseInt(String(args.group), 10) : 2; // "codex 基本不降智", minimum_balance_usd 0
  const verifyKeys = !args['no-verify'];

  const proxies = args['proxy-file']
    ? fs
        .readFileSync(String(args['proxy-file']), 'utf8')
        .split(/\r?\n/)
        .map((l) => l.split('#')[0].trim())
        .filter(Boolean)
        // WARP (127.0.0.1) is shared with other tools — exclude unless explicit.
        .filter((l) => args['allow-warp'] || !/127\.0\.0\.1/.test(l))
    : [];
  if (args.proxy) proxies.push(String(args.proxy));
  if (args['proxy-file'] && !proxies.length) {
    console.error('  ✘ proxy-file given but no usable lines — refusing to run on the machine line');
    process.exit(1);
  }
  if (proxies.length && !createAgent) console.warn('  ! proxy helper not found — running direct');

  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const keys = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  const accounts = fs.existsSync(accountsOut) ? JSON.parse(fs.readFileSync(accountsOut, 'utf8')).accounts || [] : [];
  console.log(`  target ${count} · have ${keys.length} · proxies ${proxies.length || 'none'}`);

  PROXY_POOL = proxies;
  let cursor = 0;
  const nextProxy = () => (proxies.length ? proxies[cursor++ % proxies.length] : null);

  if (args['verify-only']) {
    for (const k of keys) {
      try {
        const v = await verify(k, nextProxy(), { log: console.log });
        console.log(`  ${k.slice(0, 10)}… ${JSON.stringify(v).slice(0, 200)}`);
      } catch (e) {
        console.log(`  ${k.slice(0, 10)}… ✘ ${e.message.slice(0, 120)}`);
      }
    }
    return;
  }

  const save = () => {
    fs.writeFileSync(out, keys.join('\n') + (keys.length ? '\n' : ''));
    fs.writeFileSync(accountsOut, JSON.stringify({ generated_at: new Date().toISOString(), count: keys.length, accounts }, null, 2));
  };

  // Rescue: (a) accounts whose key creation died with the exit, (b) keys that never got
  // their verify step (exit died mid-verify) — both are recovered here against the pool.
  if (args['keys-only']) {
    for (const rec of accounts) {
      try {
        if (!rec.key) {
          const auth = await login({ email: rec.email, password: rec.password }, nextProxy());
          const { key, id } = await createKey({ token: auth.access_token, name: `${namePrefix}-${rec.n}`, groupId }, nextProxy());
          rec.key = key;
          rec.key_id = id;
          rec.group_id = groupId;
          console.log(`  rescue ${rec.email} → minted ${key.slice(0, 12)}…`);
        }
        if (rec.verify && rec.verify.ok) continue;
        const v = await verify(rec.key, nextProxy(), { log: console.log });
        rec.verify = v;
        if (v.ok && !keys.includes(rec.key)) {
          keys.push(rec.key);
          save();
          console.log(`  rescue ${rec.email} → ${rec.key.slice(0, 12)}… ✔ (keys.txt now ${keys.length})`);
        } else {
          save();
          console.log(`  rescue ${rec.email} → ✘ ${JSON.stringify(v).slice(0, 160)}`);
        }
      } catch (e) {
        console.log(`  rescue ${rec.email} ✘ ${String(e.message).slice(0, 140)}`);
      }
    }
    return;
  }

  let claimed = keys.length;
  const nextIndex = () => ++claimed;

  async function attempt(index) {
    const started = Date.now();
    const proxy = nextProxy();
    const say = (m) => console.log(`  [${index}] ${m}`);
    try {
      // Public gmail pool: plenty of mailboxes are already registered here — retry
      // the whole mailbox leg (send → code → register) before giving up.
      let lastErr = null;
      for (let spike = 0; spike < 6; spike++) {
        const box = await newGmail(proxy);
        say(`${box.plain}${box.dotted !== box.plain ? ` (dotted ${box.dotted})` : ''}${proxy ? ` · proxy ${proxy.slice(0, 40)}` : ''}`);
        try {
          await sendVerifyCode(box.plain, proxy, say);
          const code = await waitForCode(box.plain, { proxy, log: say });
          const password = `${crypto.randomBytes(9).toString('base64url')}Aa1!`;
          const auth = await register({ email: box.plain, password, code, affCode: AFF_CODE }, proxy);
          const token = auth.access_token;
          say(`registered · user id ${(auth.user && auth.user.id) || '?'}`);
          const rec = {
            n: index,
            email: box.plain,
            dotted: box.dotted,
            password,
            user_id: (auth.user && auth.user.id) || null,
            key: null,
            key_id: null,
            group_id: groupId,
            aff_code: AFF_CODE,
          };
          accounts.push(rec); // saved pre-key: a dead exit must not lose a registered account
          save();
          const { key, id } = await createKey({ token, name: `${namePrefix}-${index}`, groupId }, proxy);
          rec.key = key;
          rec.key_id = id;
          const ci = await checkIn(token, proxy).catch((e) => ({ status: 0, json: { error: e.message } }));
          const me = await getMe(token, proxy).catch(() => ({}));
          const sub = await getSubsidy(token, proxy).catch(() => ({}));
          rec.check_in = ci.json && (ci.json.data || ci.json);
          rec.balance = me.balance ?? me.quota ?? me.credit;
          rec.subsidy = sub;
          save();
          const v = verifyKeys ? await verify(key, proxy, { log: say }) : { ok: null, status: 'skipped' };
          rec.verify = v;
          if (verifyKeys && !v.ok) {
            say(`✘ key did not verify (usage ${v.usage_status}) — accounts.json flagged, not counted`);
            save();
            return false;
          }
          keys.push(key);
          save();
          say(`✔ ${key.slice(0, 14)}… (${((Date.now() - started) / 1000).toFixed(1)}s) usage=${v.usage_status} completion=${v.completion_status}${v.gate ? ' ' + v.gate : ''}`);
          return true;
        } catch (e) {
          lastErr = e;
          const m = String(e.message);
          if (/already|exists|registered|used/i.test(m) && !/rate/i.test(m)) continue; // mailbox used before
          throw e;
        }
      }
      throw lastErr || new Error('no fresh mailbox after 6 tries');
    } catch (e) {
      console.error(`  [${index}] ✘ ${String(e.message).slice(0, 160)}`);
      if (isNetworkError(e.message)) await sleep(2000);
      return false;
    }
  }

  const workers = Math.max(1, parseInt(args.workers || '2', 10));
  if (args['send-gap']) SEND_GAP_MS.v = parseInt(args['send-gap'], 10);
  if (args['mail-gap']) MAIL_GAP_MS.v = parseInt(args['mail-gap'], 10);
  if (args.timeout) REQ_TIMEOUT_MS = parseInt(args.timeout, 10);
  if (args.retries) REQ_RETRIES = parseInt(args.retries, 10);
  console.log(`  workers ${workers} · send-gap ${SEND_GAP_MS.v}ms · mail-gap ${MAIL_GAP_MS.v}ms · req-timeout ${REQ_TIMEOUT_MS}ms · retries ${REQ_RETRIES}`);
  let attempts = 0;
  const maxAttempts = count * 3 + 10;
  async function workerLoop() {
    while (keys.length < count && attempts < maxAttempts) {
      const index = nextIndex();
      attempts++;
      const ok = await attempt(index);
      if (keys.length < count) await sleep(ok ? delay : Math.min(delay, 3000));
    }
  }
  await Promise.all(Array.from({ length: workers }, workerLoop));
  console.log(`  keys → ${out} (${keys.length} line(s)) · accounts → ${accountsOut}`);
}

main().catch((e) => {
  console.error('[fatal]', e.message);
  process.exit(1);
});

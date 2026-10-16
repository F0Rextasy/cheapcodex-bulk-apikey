#!/usr/bin/env node
'use strict';

/**
 * Connect CheapCodex to a 9Router instance.
 *
 * CheapCodex ships an OpenAI-compatible endpoint (https://api.cheapcodex.online/v1), so a single
 * connection is enough: register one `openai-compatible` provider-node with
 * prefix `cheapcodex`, then one connection per key of your bulk key file.
 * Rotate keys by running this again with a new key file — the node and its
 * model list stay the same.
 *
 * Usage:
 *   node src/connect-9router.js \
 *     --base http://localhost:20128 --password 123456 \
 *     --keys-file keys.txt [--model <id>]
 *
 *   node src/connect-9router.js --api-key <one key>        # register a single key
 *
 * Options:
 *   --base <url>        9Router base URL                 [http://localhost:20128]
 *   --password <pw>     9Router password                                    [123456]
 *   --api-key <key>     register exactly this key
 *   --keys-file <file>  one key per line, `#` comments skipped  [keys.txt in
 *                       the repository root]
 *   --name <name>       connection name in 9Router                   [CheapCodex]
 *                       (keys-file mode appends -001, -002, … per key)
 *   --prefix <prefix>   provider-node prefix; model ids become
 *                       `<prefix>/<model>`                                  [cheapcodex]
 *   --base-url <url>    provider base URL                             [https://api.cheapcodex.online/v1]
 *   --model <id>        default model for new connections            [gpt-5.5]
 *
 * Keys are never printed. Connections are matched by name, so re-running is
 * safe and `--name` is what makes two keys distinct.
 *
 * Zero dependencies. Node.js >= 18.
 */

const fs = require('fs');
const path = require('path');

const HERE = path.resolve(__dirname, '..'); // data root (the repo root)
const UA = 'cheapcodex-bulk-apikey-9router-connector/1.0';

async function login9router(base, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ password: password ?? '123456' }),
  });
  const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const cookie = sc.map((c) => c.split(';')[0]).join('; ');
  return { ok: res.ok, cookie, body: (await res.text()).slice(0, 200) };
}

async function api(base, cookie, route, init = {}) {
  const res = await fetch(`${base}${route}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON bodies are reported as text */
  }
  return { status: res.status, ok: res.ok, json, text: text.slice(0, 400) };
}

async function ensureNode(base, cookie, { name, prefix, baseUrl }) {
  const list = await api(base, cookie, '/api/provider-nodes');
  const nodes = (list.json && list.json.nodes) || [];
  const existing = nodes.find((n) => n.name === name || n.prefix === prefix);
  if (existing) {
    console.log(`provider-node exists: ${existing.id} (prefix ${existing.prefix})`);
    return existing;
  }
  const created = await api(base, cookie, '/api/provider-nodes', {
    method: 'POST',
    body: JSON.stringify({ name, prefix, apiType: 'chat', type: 'openai-compatible', baseUrl }),
  });
  if (!created.ok) throw new Error(`create node failed ${created.status}: ${created.text}`);
  console.log(`provider-node created: ${created.json.node.id} (prefix ${prefix})`);
  return created.json.node;
}

async function ensureConnection(base, cookie, { nodeId, name, apiKey, defaultModel }) {
  const list = await api(base, cookie, '/api/providers');
  const conns = (list.json && list.json.connections) || [];
  const existing = conns.find((c) => c.name === name);
  if (existing) {
    console.log(`connection exists: ${existing.id} (${existing.name})`);
    return { created: false, connection: existing };
  }
  const created = await api(base, cookie, '/api/providers', {
    method: 'POST',
    body: JSON.stringify({ provider: nodeId, apiKey, name, priority: 1, defaultModel: defaultModel || null }),
  });
  if (!created.ok && created.status !== 409) {
    throw new Error(`create connection failed ${created.status}: ${created.text}`);
  }
  const connection = (created.json && created.json.connection) || null;
  console.log(`connection created: ${(connection && connection.id) || '(conflict)'} (${name})`);
  return { created: created.ok, connection };
}

/** Every non-comment, non-empty line of a key file. */
function readKeys(file) {
  const p = path.isAbsolute(file) ? file : path.join(HERE, file);
  if (!fs.existsSync(p)) throw new Error(`key file not found: ${p}`);
  const keys = fs
    .readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (!keys.length) throw new Error(`no keys in ${p}`);
  return keys;
}

async function connect9Router({
  base = 'http://localhost:20128',
  password = '123456',
  apiKey = null,
  keysFile = null,
  name = 'CheapCodex',
  prefix = 'cheapcodex',
  baseUrl = 'https://api.cheapcodex.online/v1',
  defaultModel = 'gpt-5.5',
} = {}) {
  const keys = apiKey ? [apiKey] : readKeys(keysFile || 'keys.txt');
  const { ok, cookie, body } = await login9router(base, password);
  console.log(`9Router login: ${ok ? 'ok' : 'not required/failed'}${ok ? '' : ` ${body}`}`);
  const node = await ensureNode(base, cookie, { name, prefix, baseUrl });
  let added = 0;
  for (let i = 0; i < keys.length; i++) {
    const connName = apiKey ? name : `${name}-${String(i + 1).padStart(3, '0')}`;
    const { created } = await ensureConnection(base, cookie, { nodeId: node.id, name: connName, apiKey: keys[i], defaultModel });
    if (created) added += 1;
  }
  console.log(`\nDone. ${added}/${keys.length} connection(s) added · models: cheapcodex/gpt-5.5 · cheapcodex/deepseek-v3.2 · cheapcodex/gpt-4o-mini`);
  return { node, added, total: keys.length };
}

if (require.main === module) {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[k] = v;
    }
  }
  connect9Router({
    base: args.base,
    password: args.password,
    apiKey: args['api-key'],
    keysFile: args['keys-file'],
    name: args.name,
    prefix: args.prefix,
    baseUrl: args['base-url'],
    defaultModel: args.model,
  }).catch((e) => {
    console.error('[fatal] ' + e.message);
    process.exit(1);
  });
}

module.exports = { connect9Router, login9router, ensureNode, ensureConnection };

'use strict';
/**
 * cheapcodex status/screen probe — confirm the sign-up gates (New API `/api/status`,
 * unauthenticated) and find exits that actually carry the target.
 *
 *   node src/status.js --screen 60        # screen 60 candidates, keep live exits
 *   node src/status.js --pool out/pool.txt --status   # re-read gates via existing pool
 *
 * Candidates: out/new-live.txt (fresh) then union-live.txt, then WARP SOCKS.
 */
const fs = require('fs');
const path = require('path');
const { probe, fetchText, parseProxy } = require('./proxy.js');

const HOST = 'api.cheapcodex.online';
const ROOT = path.resolve(__dirname, '..'); // data root (the repo root)
const OUT = path.join(ROOT, 'out');
const POOL_FILE = path.join(OUT, 'pool.txt');
let PROBE_TIMEOUT = 15000;
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

function loadPool(file) {
  const p = path.join(ROOT, 'out', file);
  const out = [];
  if (!fs.existsSync(p)) return out;
  for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = l.split('#')[0].trim();
    if (t) out.push(t);
  }
  return out;
}

const shuffle = (a) => {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
};

async function checkExit(line) {
  const p = parseProxy(line);
  if (!p) return null;
  const t0 = Date.now();
  try {
    // The panel is sub2api (no /api/status): settings/public is the JSON liveness+policy probe.
    const r = await fetchText(p, `https://${HOST}/api/v1/settings/public`, {
      timeoutMs: PROBE_TIMEOUT,
      headers: { 'X-User-UI-Request': '1' },
    });
    const ms = Date.now() - t0;
    let json = null;
    try {
      json = JSON.parse(r);
    } catch (e) {}
    if (!json || json.code !== 0) return null;
    return { line, ms, json };
  } catch (e) {
    return null;
  }
}

/** Appends every hit to pool.txt immediately: a killed run keeps its finds. */
function appendPool(line) {
  fs.mkdirSync(OUT, { recursive: true });
  const prev = fs.existsSync(POOL_FILE) ? fs.readFileSync(POOL_FILE, 'utf8') : '';
  if (!prev.split(/\r?\n/).includes(line)) fs.appendFileSync(POOL_FILE, line + '\n');
}

async function mapPool(items, workers, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        const r = await fn(items[idx], idx);
        if (r) out.push(r);
      }
    })
  );
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let lines;
  if (args.pool) {
    lines = fs
      .readFileSync(String(args.pool), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.split('#')[0].trim())
      .filter(Boolean);
    if (args.out) fs.writeFileSync(String(args.out), '');
  } else {
    const want = parseInt(args.screen || '60', 10);
    PROBE_TIMEOUT = parseInt(args.timeout || '20000', 10);
    const MAX_RUNTIME = parseInt(args['max-runtime'] || '900000', 10);
    const fresh = shuffle(loadPool('new-live.txt'));
    const union = shuffle(loadPool('union-live.txt').filter((l) => !fresh.includes(l)));
    const wantFresh = Math.min(fresh.length, Math.max(1, Math.round(want * 0.4)));
    lines = [...fresh.slice(0, wantFresh), ...union.slice(0, want - wantFresh)];
    const roundOut = args.out ? String(args.out) : null;
    if (roundOut) fs.writeFileSync(roundOut, '');
    console.log(`  screening ${lines.length} candidates (${wantFresh} fresh) · timeout ${PROBE_TIMEOUT}ms · cap ${MAX_RUNTIME / 1000}s`);
    const t0 = Date.now();
    const results = [];
    await mapPool(lines, 8, async (line) => {
      if (Date.now() - t0 > MAX_RUNTIME) return null;
      const r = await checkExit(line);
      if (r) {
        appendPool(r.line);
        if (roundOut) fs.appendFileSync(roundOut, r.line + '\n');
        results.push(r);
        console.log(`  ✔ ${line}  ${r.ms}ms`);
      }
      return null;
    });
    fs.appendFileSync(path.join(OUT, 'pool-latency.tsv'), results.map((r) => `${r.line}\t${r.ms}`).join('\n') + '\n');
    console.log(`\n  live exits this round: ${results.length}/${lines.length} → ${roundOut || POOL_FILE}`);
    const sample = results[0];
    if (sample) {
      const d = sample.json.data || {};
      const gates = {};
      for (const k of ['registration_enabled', 'email_verify_enabled', 'registration_email_suffix_whitelist', 'promo_code_enabled', 'invitation_code_enabled', 'turnstile_enabled', 'turnstile_site_key', 'site_name', 'api_base_url']) gates[k] = d[k];
      console.log(`\n  gates via ${sample.line}:`);
      console.log(JSON.stringify(gates, null, 2));
    }
    return;
  }

  const results = await mapPool(lines, 8, async (line) => {
    const r = await checkExit(line);
    if (r) {
      if (args.out) {
        fs.appendFileSync(String(args.out), r.line + '\n');
      } else {
        appendPool(r.line);
      }
      console.log(`  ✔ ${line}  ${r.ms}ms`);
    }
    return null;
  });
  const target = args.out ? String(args.out) : POOL_FILE;
  if (args.out) {
    const kept = lines.filter((l) => fs.readFileSync(String(args.out), 'utf8').split(/\r?\n/).includes(l));
    fs.writeFileSync(String(args.out), [...new Set(kept)].join('\n') + '\n');
  }
  console.log(`\n  live exits: ${results.length}/${lines.length} → ${target}`);
}

main().catch((e) => {
  console.error('[fatal]', e.message);
  process.exit(1);
});

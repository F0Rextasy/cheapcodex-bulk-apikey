<div align="center">

```
 ██████╗██╗  ██╗███████╗ █████╗ ██████╗  ██████╗ ██████╗ ██████╗ ███████╗
██╔════╝██║  ██║██╔════╝██╔══██╗██╔══██╗██╔════╝██╔═══██╗██╔══██╗██╔════╝
██║     ███████║█████╗  ███████║██████╔╝██║     ██║   ██║██║  ██║█████╗
██║     ██╔══██║██╔══╝  ██╔══██║██╔═══╝ ██║     ██║   ██║██║  ██║██╔══╝
╚██████╗██║  ██║███████╗██║  ██║██║     ╚██████╗╚██████╔╝██████╔╝███████╗
 ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝      ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝

██╗  ██╗
╚██╗██╔╝
 ╚███╔╝
 ██╔██╗
██╔╝ ██╗
╚═╝  ╚═╝
```

# cheapcodex-bulk-apikey

**Bulk-create CheapCodex accounts with auto-generated API keys — OpenAI-compatible inference + 9Router connector.**

[![Node](https://img.shields.io/badge/Node-%E2%89%A518-3DA639?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blue?style=for-the-badge)](#)
[![License](https://img.shields.io/badge/license-MIT-6ea8fe?style=for-the-badge)](LICENSE)
[![Models](https://img.shields.io/badge/models-5%20served-412991?style=for-the-badge)](https://api.cheapcodex.online)
[![9Router](https://img.shields.io/badge/9Router-connector-8B5CF6?style=for-the-badge)](#-connect-to-9router)
[![X](https://img.shields.io/badge/X-%40bigbullapp-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/bigbullapp)

[🛠 Quick start](#-quick-start) · [🎁 Free tier](#-free-tier--how-much-you-get) · [🤖 Models](#-models--all-5-of-them) · [🧪 Use the API](#-how-to-use-the-api) · [✅ Verified](#-verified-working--every-key-is-tested) · [🧭 How it works](#-how-it-works) · [🔌 9Router](#-connect-to-9router) · [⚙️ Options](#️-cli-options) · [🛰️ Proxies](#️-behind-a-proxy) · [🐞 Issues](#-issues)

</div>

---

## ✨ Why this exists

The credit on this panel lives on the **account**, not on the key: `POST /api/v1/keys` mints a key owned by an account, and the relay checks that account's balance on every call. One account per key is therefore the right unit, and this tool walks the whole path unattended.

Sign-up mail has to come from a real `@qq.com` or `@gmail.com` mailbox, because that rule is enforced server-side and every other domain is refused. Beyond that the flow is plain REST JSON — no browser, no captcha (Turnstile is provisioned and switched off), no card:

```
proxies.txt ──▶ screen: an exit is used only after it answers the panel right now
                    │
                    ▼
POST /api/v1/auth/send-verify-code {email}                          → 6-char code by mail
POST /api/v1/auth/register {email,password,verify_code,aff_code}
     └─▶ 200 {access_token, refresh_token, user}                     (JWT pair, auto-login)
          └─▶ POST /api/v1/keys {name, group_id:2, ip_whitelist:[]}  → sk-<64hex>
               └─▶ GET /v1/usage → 200 {isValid:true}                ⇐ the live proof
                    └─▶ keys.txt
```

## 🎁 Free tier — how much you get

**The funding gate, up front — this is a funding park, not a registration park.** Registration, e-mail verification and key creation all work, and every key this tool writes is live (`GET /v1/usage` → `200 {"isValid":true}`). But the provider's sign-up credit campaign ("百亿补贴", advertised as **$20 + $20/day** check-in) has been **paused since 2026-09-02**, so a fresh account sits at **balance $0** and `/v1/models` (plus every chat model) answers `403 INSUFFICIENT_BALANCE`. **The keys are real and group-bound; the accounts need a credit top-up.**

| What | Value |
| --- | --- |
| Welcome credit | advertised **$20 + $20/day** check-in — **paused since 2026-09-02** → fresh accounts at **balance $0** |
| Card required | **No** |
| Sign-up | `POST /api/v1/auth/send-verify-code` → `POST /api/v1/auth/register` — mailbox must be `@qq.com` / `@gmail.com` |
| Key | `POST /api/v1/keys {name, group_id:2}` → `sk-<64hex>` (group 2: codex 基本不降智, ×2) |
| Live proof | `GET /v1/usage` → `200 {isValid:true, balance:0}` — the only call that answers on $0 |
| Chat / models on $0 | `403 INSUFFICIENT_BALANCE` until funded — the catalogue is gated, not missing |
| The unit that scales | **one account = one key** → `--count N` is N funded budgets once topped |

> 💡 The free tier is set by CheapCodex and can change. Check the live numbers at [cheapcodex.online](https://cheapcodex.online) — and let the tool's own gate decide:

```bash
node src/cli.js verify --verify-only     # every key in keys.txt is re-tested with a live /v1/usage call
```

## 🤖 Models — all 5 of them

**Cannot be enumerated at $0 balance.** `GET /v1/models` → `403 {"code":"INSUFFICIENT_BALANCE"}` on a creditless account — so the id list is not measurable today. What *is* measured is the route (each id below was probed and was **routed**, then gated by balance):

| id | evidence |
| --- | --- |
| `gpt-6-astra` | provider announcement #41 puts it live on this panel |
| `gpt-5.5` · `gpt-5.1-mini` · `deepseek-v3.2` · `gpt-4o-mini` | probed against the relay, all four routed and gated by balance |

Groups visible to a user session (`GET /api/v1/groups/available`) — every one with `minimum_balance_usd: 0`, so only the **account-level balance** stands between a key and service:

| group | name | platform | rate multiplier |
| --- | --- | --- |
| 2 | codex 基本不降智 | openai | ×2 |
| 19 | codex pro expensive and good！！ | openai | ×3 |
| 32 | 百分百不降智 | openai | ×4 |
| 33 | claude code | anthropic | ×15 |

Minted keys go into **group 2** (`minimum_balance_usd: 0`); group 33 serves `/v1/messages`. [`models.json`](src/models.json) holds the measured snapshot (`catalog_status: "gated"`).

## 🧪 How to use the API

The base URL is **`https://api.cheapcodex.online/v1`** — OpenAI-compatible. A creditless key proves at `/v1/usage`; chat/models answer once the account is funded:

**Prove the key today** (works at $0):

```bash
curl https://api.cheapcodex.online/v1/usage -H "Authorization: Bearer sk-…"
# {"isValid":true,"balance":0,"planName":"钱包余额"}
```

**Once funded** — any SDK / curl:

```python
from openai import OpenAI
client = OpenAI(base_url="https://api.cheapcodex.online/v1", api_key="sk-…")
print(client.chat.completions.create(model="gpt-5.5",
      messages=[{"role":"user","content":"hi"}]).choices[0].message.content)
```

```bash
curl https://api.cheapcodex.online/v1/chat/completions \
  -H "Authorization: Bearer sk-…" -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.5","messages":[{"role":"user","content":"hi"}]}'
```

## 🛠 Quick start

```bash
git clone https://github.com/F0Rextasy/cheapcodex-bulk-apikey.git
cd cheapcodex-bulk-apikey

# 1) your proxy list, one exit per line (http://, socks5://, socks4:// or bare host:port)
printf 'socks5://127.0.0.1:1080\n' > proxies.txt

# 2) go
node src/launcher.js                                                   # interactive: mint / verify / screen / settings
# or drive it directly:
node src/cli.js screen --screen 60 --out round.txt                     # exits that carry the host right now
node src/cli.js mint   --count 30 --workers 2 --proxy-file round.txt   # any N; 30 is just the sample default
node src/cli.js verify --verify-only                             # re-check every key in keys.txt
node src/cli.js probe  --accounts accounts.json --n 1                  # deep probe of one account
```

`node src/cli.js help` lists the tasks, and the options table below lists the flags each task actually reads. Keys are appended to `keys.txt`, one per line, the moment a key verifies (`GET /v1/usage` 200).

### 🖱️ The launcher

The launcher is `src/launcher.js`: a menu over mint / verify / probe / screen, with `proxies.txt` and `keys.txt` counters in the header. It remembers `count` and `conc` in `launcher.config.json` and runs the task modules with the right flags. `node src/launcher.js --connect-9router` registers the keys in a local 9Router.

## ✅ Verified working — every key is tested

A key reaches `keys.txt` only after the provider's own API answers with it:

| check | call | measured |
| --- | --- |
| the key authenticates and is group-bound | `GET https://api.cheapcodex.online/v1/usage` | **200** `{balance:0, isValid:true, planName:"钱包余额"}` |
| the relay is reachable with the key | `POST /v1/chat/completions` | **403** `INSUFFICIENT_BALANCE` — the account-level funding gate, not a key defect |
| the catalog | `GET /v1/models` | **403** `INSUFFICIENT_BALANCE` while balance is 0 |

| metric | value |
| --- | --- |
| accounts created | **29** (user ids 4442–4473) |
| keys persisted and live-validated | **17** (`keys.txt`, every one `usage 200`) |
| final verification pass | **17/17 ok** |

```bash
node src/cli.js verify --verify-only    # reproduces GET /v1/usage for your file
```

## 🧭 How it works

```
inbox (one address per account)                                  a fresh address per account
   │
   ├─▶ sign-up: CheapCodex page → e-mail address → code / link from the inbox
   ├─▶ session: the account's cookies or access token in hand
   ├─▶ key mint: the account's key endpoint → plaintext key returned once (written to disk immediately)
   └─▶ live proof: POST https://api.cheapcodex.online/v1/chat/completions → real content = the key is live
```

Per account, with each request leaving through an exit that answered the panel moments earlier:

1. a fresh gmail box from Emailnator (the dotted address and its dot-free twin are one inbox), used in its dot-free form;
2. `POST /api/v1/auth/send-verify-code`, then poll the mailbox for the 6-char code (`[A-Z0-9]{6}`, with a `[0-9]{6}` fallback);
3. `POST /api/v1/auth/register` with `verify_code` and `aff_code`; the response carries the JWT pair, so the account is usable straight away with no second login;
4. the account record is written to `accounts.json` **before** the key step, so a dying exit cannot lose a registration;
5. `POST /api/v1/keys` with `group_id: 2`, which returns `sk-<64 hex>`;
6. `GET /v1/usage` plus a chat probe with that key; the key is appended to `keys.txt` the moment it verifies, and the verify block is stored with the account;
7. a daily check-in is attempted and the campaign snapshot is stored per account.

## ⚙️ CLI options

```bash
node src/cli.js mint   --count 30 --workers 2 --proxy-file proxies.txt
node src/cli.js mint   --keys-only                 # rescue: keys for records whose key step died
node src/cli.js verify --verify-only                             # re-check every key in keys.txt
node src/cli.js probe  --accounts accounts.json --n 1   # deep probe of one account
node src/cli.js screen --screen 60 --out round.txt # candidate exits that carry the host right now
```

| task | flags |
| --- | --- |
| `mint` | `--count N` (30) · `--workers N` (2) · `--proxy-file <pool>` · `--proxy <one exit>` · `--allow-warp` (keep `127.0.0.1` pool lines) · `--group N` (2) · `--out keys.txt` · `--accounts accounts.json` · `--name-prefix ccx-bulk` · `--send-gap MS` (20000) · `--mail-gap MS` (6000) · `--timeout MS` (45000) · `--retries N` (3) · `--delay MS` (4000) · `--no-verify` |
| `mint --keys-only` | rescue pass over `accounts.json`: mints a key for every record without one and re-verifies records whose verify step died with its exit |
| `mint --verify-only` | re-checks every key in `--out` (default `keys.txt`) with `GET /v1/usage` plus a chat probe, one line per key |
| `probe` | `--accounts accounts.json` · `--n N` (which record, 1-based) · `--group N` (mint a fresh key into that group first) · `--models a,b,c` (chat models to try) · `--proxy-file <pool>`: a deep single-account probe |
| `screen` | `--screen N` (60 candidates) · `--out <file>` · `--timeout MS` (20000) · `--max-runtime MS` (900000) · `--pool <file>` (re-read the gates through an existing pool) |

## 🛰️ Behind a proxy

* `proxies.txt` is the default pool path: the launcher counts the exits in it, and CLI tasks take the same file with `--proxy-file proxies.txt`. One exit per line: `scheme://user:pass@host:port`, `scheme://host:port`, or bare `host:port` (defaults to `http://`). `http`, `socks5` and `socks4` all work; `#` comments and blank lines are ignored.
* An exit is handed to an account only after it answers `GET /api/v1/settings/public` right then, and every request inside an account rotates to the next pool line on a network error, so one dead line costs one retry, not the account.
* A `--proxy-file` that yields no usable line makes the mint refuse to start rather than fall back to your own address. With no proxy flag at all the requests go out direct, so pass a pool (or `--proxy <one exit>`).
* Free exits are short-lived: screen a round of candidates, mint from that round, repeat — the bundled `screen` task exists for exactly that loop.

## 📄 Files

| Path | Contents |
| --- | --- |
| `keys.txt` | one live-validated key per line, git-ignored |
| `accounts.json` | per-account record: email, dot-free twin, password, key, key id, group, check-in, campaign snapshot, verify block |
| [`src/models.json`](src/models.json) | the measured catalog snapshot, group table and `/v1/usage` shape (`catalog_status: "gated"`) |
| `outputs/` | screen logs, batch logs, rescue log, verification passes, raw gate snapshots, git-ignored |
| `proxies.txt` | your proxy pool, one proxy per line, git-ignored |

## 🔌 Connect to 9Router

[9Router](https://9router.com) is a self-hosted, OpenAI-compatible router. CheapCodex serves an OpenAI-compatible endpoint (`https://api.cheapcodex.online/v1`), so register it once and use every key:

```bash
node src/connect-9router.js \
  --base http://localhost:20128 --password 123456 \
  --keys-file keys.txt
```

Every key in `keys.txt` becomes one connection of the `cheapcodex` provider node (`--api-key <key>` registers a single key instead, `--model <id>` overrides the default). Then pick a model inside 9Router:

```
cheapcodex/gpt-5.5
cheapcodex/deepseek-v3.2
cheapcodex/gpt-4o-mini
```

Point the connector at a refreshed `keys.txt` to add more accounts; the node and its model list stay the same. `node src/launcher.js --connect-9router` runs exactly this and asks for the base URL and password first.

Defaults: `--base http://localhost:20128`, `--password 123456`, `--name CheapCodex`, `--prefix cheapcodex`, `--base-url https://api.cheapcodex.online/v1`, `--model gpt-5.5`.

## 🔑 What one key gets you

| | |
| --- | --- |
| 🏢 Provider | **CheapCodex** — [cheapcodex.online](https://cheapcodex.online) |
| 🎁 What the provider gives | funding-park relay — keys are live (usage 200) but the $20+$20/day campaign is paused since 2026-09-02, so funding is the gate |
| 🔑 What one key gets you | one API key scoped to its own account: the 5 model ids on the endpoint below, at your plan's limits. The quota lives on the **account**, which is exactly why this tool creates one account per key |
| 🌐 API shape | OpenAI-compatible: `POST https://api.cheapcodex.online/v1/chat/completions` |
| 🔒 Your data | only cheapcodex.online and the inbox backend you configure are contacted; keys stay on your machine |

## 🐞 Issues

Open an issue with the failing step, the exit used and the tool's stdout; the dumps in `outputs/` (gate snapshots, screen and batch logs) make a failure reproducible without leaking a key. **[Open an issue](../../issues)** with the command you ran and the exact output; PRs are welcome. Funding is the gate — if `GET /v1/models` still answers `403 INSUFFICIENT_BALANCE`, the account needs credits or the campaign has to resume; the keys themselves are unaffected.

## 📄 License

MIT © 2026 — see [LICENSE](LICENSE).

<div align="center">

**[MIT](LICENSE)** © 2026 cheapcodex-bulk-apikey contributors

</div>

## ⚡ Run shape (presets)

`--preset=turbo|balanced|safe` sets workers + the pause between accounts (turbo = 5,
balanced = 4, safe = 2); explicit `--conc`/`--gap` (or the repo's own flags) always win,
and without `--preset` the tool keeps its historical shape exactly.

Turbo önerilir (5 worker); daha fazlası zayıf bilgisayarda yük/ban riski.

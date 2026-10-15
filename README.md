<div align="center">

```
███████╗ ██████╗ ██████╗ ███████╗██╗  ██╗████████╗ █████╗ ███████╗██╗   ██╗
██╔════╝██╔═████╗██╔══██╗██╔════╝╚██╗██╔╝╚══██╔══╝██╔══██╗██╔════╝╚██╗ ██╔╝
█████╗  ██║██╔██║██████╔╝█████╗   ╚███╔╝    ██║   ███████║███████╗ ╚████╔╝
██╔══╝  ████╔╝██║██╔══██╗██╔══╝   ██╔██╗    ██║   ██╔══██║╚════██║  ╚██╔╝
██║     ╚██████╔╝██║  ██║███████╗██╔╝ ██╗   ██║   ██║  ██║███████║   ██║
╚═╝      ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚══════╝   ╚═╝
```

# cheapcodex-bulk-apikey

**One [CheapCodex](https://api.cheapcodex.online) account per API key, minted over plain REST with an e-mail code, and written to disk only after the provider's own `/v1/usage` confirms it. The keys are real; inference waits on credit top-up — read the note below.**

[![Node](https://img.shields.io/badge/Node-%E2%89%A518-3DA639?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blue?style=for-the-badge)](#)
[![License](https://img.shields.io/badge/license-MIT-6ea8fe?style=for-the-badge)](LICENSE)
[![Catalog](https://img.shields.io/badge/catalog-gated%20by%20balance-d97706?style=for-the-badge)](#-models--free-tier)
[![X](https://img.shields.io/badge/X-%40bigbullapp-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/bigbullapp)

[🛠 Quick start](#-quick-start) · [✅ Verified](#-verified-working) · [🤖 Models & free tier](#-models--free-tier) · [🧭 How it works](#-how-it-works) · [⚙️ Options](#️-options) · [🛰️ Proxies](#️-behind-a-proxy) · [🐞 Issues](#-issues)

</div>

---

> **Mint as many accounts/keys as you need. There is no cap.** `--count N` (default `30`) takes any N:
> one account, one key, every key validated before it lands in `keys.txt`.

> **The funding gate, up front — this is a funding park, not a registration park.** Registration,
> e-mail verification and key creation all work, and every key this tool writes is live
> (`GET /v1/usage` → `200 {"isValid":true}`). But the provider's sign-up credit campaign
> (“百亿补贴”, advertised as **$20 + $20/day** check-in) has been **paused since 2026-09-02**, so a fresh
> account sits at **balance $0** and `/v1/models` (plus every chat model) answers
> `403 INSUFFICIENT_BALANCE`. **The keys are real and group-bound; the accounts need a credit top-up.**
> The moment an account is funded — or the campaign resumes — the same keys serve traffic with no
> re-mint.

## ✨ Why this exists

The credit on this panel lives on the **account**, not on the key: `POST /api/v1/keys` mints a key owned
by an account, and the relay checks that account's balance on every call. One account per key is
therefore the right unit, and this tool walks the whole path unattended.

Sign-up mail has to come from a real `@qq.com` or `@gmail.com` mailbox, because that rule is enforced
server-side and every other domain is refused. Beyond that the flow is plain REST JSON — no browser, no
captcha (Turnstile is provisioned and switched off), no card:

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

## 🛠 Quick start

```bash
git clone https://github.com/F0Rextasy/cheapcodex-bulk-apikey.git
cd cheapcodex-bulk-apikey

# 1) your proxy list, one exit per line (http://, socks5://, socks4:// or bare host:port)
printf 'socks5://127.0.0.1:1080\n' > proxies.txt

# 2) go
node launcher.js                                                   # interactive: mint / verify / screen / settings
# or drive it directly:
node cli.js screen --screen 60 --out round.txt                     # exits that carry the host right now
node cli.js mint   --count 30 --workers 2 --proxy-file round.txt   # any N; 30 is just the sample default
node cli.js verify                                           # re-check every key in keys.txt
node cli.js probe  --accounts accounts.json --n 1                  # deep probe of one account
```

`node cli.js help` lists the tasks, and the [options table](#️-options) lists the flags each task
actually reads. Keys are appended to `keys.txt`, one per line, the moment a key verifies.

## ✅ Verified working

A key reaches `keys.txt` only after the provider's own API answers with it:

| check | call | measured |
|---|---|---|
| the key authenticates and is group-bound | `GET https://api.cheapcodex.online/v1/usage` | **200** `{balance:0, isValid:true, planName:"钱包余额"}` |
| the relay is reachable with the key | `POST /v1/chat/completions` | **403** `INSUFFICIENT_BALANCE` — the account-level funding gate, not a key defect |
| the catalog | `GET /v1/models` | **403** `INSUFFICIENT_BALANCE` while balance is 0, so the id list is [not measurable](#-models--free-tier) today |

| metric | value |
|---|---|
| accounts created on the provider | **29** (user ids 4442–4473) |
| keys persisted and live-validated | **17** (`keys.txt`, every one `usage 200`) |
| final verification pass | **17/17 ok** |

`node cli.js verify` reproduces the check for your own file, and no key that fails verification is ever
written.

## 🤖 Models & free tier

**What the provider gives you, and what it costs today.**

| | |
| --- | --- |
| Free tier | The sign-up/check-in credit campaign (advertised **$20 + $20/day**, check-in reward `20`) is **paused since 2026-09-02** → fresh accounts are at **balance $0**; the keys work, the balance gate blocks model access |
| How to use a key today | Fund the account (top-up / recharge — unaffected by the pause), or wait for the campaign to resume; the keys already minted need no changes |
| Model catalogue | Cannot be enumerated at $0 balance: `GET /v1/models` → `403 {"code":"INSUFFICIENT_BALANCE"}`. What *is* measured is the route, not a count — see the table below |
| Rate limits | Not measurable while the balance gate answers first; the group multipliers below are the provider's published cost factors |

Ids the relay routes (each answered `403 INSUFFICIENT_BALANCE` for a $0 account — the path is proven,
the catalogue is gated behind the balance):

| id | evidence |
|---|---|
| `gpt-6-astra` | provider announcement #41 puts it live on this panel |
| `gpt-5.5` · `gpt-5.1-mini` · `deepseek-v3.2` · `gpt-4o-mini` | probed against the relay, all four routed and gated by balance |

Groups visible to a user session (`GET /api/v1/groups/available`) — every one with
`minimum_balance_usd: 0`, so only the **account-level balance** stands between a key and service:

| group | name | platform | rate multiplier |
|---|---|---|---|
| 2 | codex 基本不降智 | openai | ×2 |
| 19 | codex pro expensive and good！！ | openai | ×3 |
| 32 | 百分百不降智 | openai | ×4 |
| 33 | claude code | anthropic | ×15 |

Minted keys go into **group 2** (`minimum_balance_usd: 0`); group 33 serves the Anthropic protocol at
`/v1/messages`.

**Want more of it?** One account per key, and the balance is per account: N keys = N accounts, each with
its own budget the moment you fund it (or the campaign returns). Nothing has to be re-minted —
[`models.json`](models.json) holds the measured snapshot (`catalog_status: "gated"`, the gate body, the
group table, the `/v1/usage` shape).

## 🧭 How it works

Per account, with each request leaving through an exit that answered the panel moments earlier:

1. a fresh gmail box from Emailnator (the dotted address and its dot-free twin are one inbox), used in its
   dot-free form;
2. `POST /api/v1/auth/send-verify-code`, then poll the mailbox for the 6-char code (`[A-Z0-9]{6}`, with a
   `[0-9]{6}` fallback);
3. `POST /api/v1/auth/register` with `verify_code` and `aff_code`; the response carries the JWT pair, so the
   account is usable straight away with no second login;
4. the account record is written to `accounts.json` **before** the key step, so a dying exit cannot lose a
   registration;
5. `POST /api/v1/keys` with `group_id: 2` (the openai group with `minimum_balance_usd: 0`), which returns
   `sk-<64 hex>`;
6. `GET /v1/usage` plus a chat probe with that key; the key is appended to `keys.txt` the moment it verifies,
   and the verify block (`usage_status`, `balance`, `completion_status`, `gate`) is stored with the account;
7. a daily check-in is attempted and the campaign snapshot is stored per account.

Screen and mint stay separate rounds: `screen` keeps only the exits that answer
`GET /api/v1/settings/public` right then, and `mint --proxy-file <round>` draws from that round's file.

### State per account

`accounts.json` holds email, dot-free twin, password, `key`, `key_id`, `group_id`, the check-in result,
the campaign snapshot and the verify block. That is what makes a mail-free rescue run possible:
`mint --keys-only` re-mints a key for every record without one and re-verifies the records whose verify
step died with its exit.

## ⚙️ Options

```bash
node cli.js mint   --count 30 --workers 2 --proxy-file proxies.txt
node cli.js mint   --keys-only                 # rescue: keys for records whose key step died
node cli.js verify                                           # re-check every key in keys.txt
node cli.js probe  --accounts accounts.json --n 1   # deep probe of one account
node cli.js screen --screen 60 --out round.txt # candidate exits that carry the host right now
```

| task | flags |
|---|---|
| `mint` | `--count N` (30) · `--workers N` (2) · `--proxy-file <pool>` · `--proxy <one exit>` · `--group N` (2) · `--out keys.txt` · `--accounts accounts.json` · `--name-prefix ccx-bulk` · `--send-gap MS` (20000) · `--mail-gap MS` (6000) · `--timeout MS` (45000) · `--retries N` (3) · `--delay MS` (4000) · `--no-verify` |
| `mint --keys-only` | rescue pass over `accounts.json`: mints a key for every record without one and re-verifies records whose verify step died with its exit |
| `mint --verify-only` | re-checks every key in `--out` with `GET /v1/usage` plus a chat probe, one line per key |
| `verify` | `--accounts accounts.json` · `--n N` (which record, 1-based) · `--group N` (mint a fresh key into that group first) · `--models a,b,c` (chat models to try) · `--proxy-file <pool>`: a deep single-account probe that logs the login, `/v1/usage`, `/v1/models` and every chat reply |
| `screen` | `--screen N` (60 candidates) · `--out <file>` · `--timeout MS` (20000) · `--max-runtime MS` (900000) · `--pool <file>` (re-read the gates through an existing pool instead of screening) |

A sample batch ran as `--workers 2 --send-gap 20000 --timeout 30000 --retries 2`.

| file | contents |
|---|---|
| `cli.js` | task dispatcher: `mint` → `mint.js`, `verify` → `probe-key.js`, `screen` → `status.js` |
| `launcher.js` | interactive menu over the same three tasks; remembers count, concurrency and the chat-proof switch in `launcher.config.json` |
| `mint.js` | the account and key pipeline, including the keyless rescue and the file-wide re-verification |
| `status.js` | gate snapshot and exit screening |
| `probe-key.js` | single-account deep probe |
| `keys.txt` | one live-validated key per line, git-ignored |
| `accounts.json` | per-account record: email, dot-free twin, password, key, key id, group, check-in, campaign snapshot, verify block |
| `models.json` | the measured catalog snapshot, group table and `/v1/usage` shape |
| `outputs/` | screen logs, batch logs, rescue log, verification passes, raw gate snapshots, git-ignored |
| `proxies.txt` | your proxy pool, one proxy per line, git-ignored |

## 🛰️ Behind a proxy

* `proxies.txt` is the default pool path: the launcher counts the exits in it, and CLI tasks take the same
  file with `--proxy-file proxies.txt`. One exit per line: `scheme://user:pass@host:port`,
  `scheme://host:port`, or bare `host:port` (defaults to `http://`). `http`, `socks5` and `socks4` all work;
  `#` comments and blank lines are ignored.
* An exit is handed to an account only after it answers `GET /api/v1/settings/public` right then, and every
  request inside an account rotates to the next pool line on a network error (`SOCKS`, `CONNECT`, timeout,
  TLS, `ECONN`, certificate), so one dead line costs one retry, not the account.
* A `--proxy-file` that yields no usable line makes the mint refuse to start rather than fall back to your
  own address. With no proxy flag at all the requests go out direct, so pass a pool (or `--proxy <one exit>`).
* Free exits are short-lived: screen a round of candidates, mint from that round, repeat — the bundled
  `screen` task exists for exactly that loop.

## 🐞 Issues

Open an issue with the failing step, the exit used and the tool's stdout; the dumps in `outputs/` (gate
snapshots, screen and batch logs) make a failure reproducible without leaking a key.

## 📄 License

MIT © 2026, see [LICENSE](LICENSE). Use it on accounts you are allowed to create.

---

<div align="center">

**Built by F0REXTASY** · [github.com/F0Rextasy](https://github.com/F0Rextasy) · [x.com/bigbullapp](https://x.com/bigbullapp)

</div>

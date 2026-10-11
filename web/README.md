# Redeye web

The desk for Redeye, an earnings-night agent for people in India, Singapore and Southeast Asia who hold US stocks. US companies report at 4 pm in New York, which is 1:30 am in Mumbai. You write a rule in plain English before bed. Redeye watches every tokenized version of the stock on BNB Chain (Ondo, bStocks, xStocks) through US after-hours and acts on the best one that can trade.

## What the web app does

- **Night strip (`/`)**: a 24 hour band in Mumbai or Singapore time with the US premarket, regular and after-hours sessions laid over it from New York session math (daylight-saving correct), the sleep hours shaded, a live now marker, and the Binance market status beside it.
- **Order slip**: type "if TSLA drops 8% buy $6" and press Read. The rule is parsed against a strict schema (exact pattern match first, Claude as fallback when `ANTHROPIC_API_KEY` is set) and prints back as the slip's filled fields. Leave it for tonight posts to `/api/arm`, which stores the rule with its watch window, and only then does the stub tear off and print "Armed. Watching ...".
- **Price ladder**: every Ondo, bStocks and xStocks token of the ticker at its live per-share price, against the last close and the trigger, each marked tradable or not with the reason, from a real quote request at the size of your rule.
- **Morning receipts**: the receipts of every check on the rules you armed, as a stack of slips with the rules still on watch on top, then newest first, with the outcome, the reason, the token chosen and a BscScan link when a transaction exists.
- **`/api/tick`**: the cron entry. With `Authorization: Bearer $CRON_SECRET` it runs, for every armed rule, the agent's own tick (evaluate, last close, per-version quote, Transaction API simulate) as a dry run and appends a receipt. Without the bearer it answers 401. The web never signs.
- **Replay (`/proof`)**: Tesla's 22 July 2026 earnings night on a scrubbable Mumbai clock, TSLAon and TSLAB against the real after-hours price, with the full data table.

## Run it

From this directory:

```bash
npm install && npm run dev
```

The server reads `../.env` (the repo root) for `BINANCE_W3_API_KEY` and `BINANCE_W3_API_SECRET`. Keys stay in the Node server process and are never sent to the browser. The page quotes and reads; it never signs.

State is read from `../data` by default, the same directory the CLI writes. Set `REDEYE_DATA_DIR` to an absolute path to read a different state directory.

On Vercel (`BLOB_READ_WRITE_TOKEN` present) rules and receipts live in a private Vercel Blob store, one folder per visitor keyed by an httpOnly cookie, so visitors do not see each other's rules. `vercel.json` schedules `/api/tick` every 10 minutes; set `CRON_SECRET` in the project environment and Vercel sends it as the bearer.

```bash
npm run build && npm start   # production build
```

## Layout

- `app/page.tsx`, `app/proof/page.tsx`, `app/api/rule/route.ts`, `app/api/status/route.ts`: the routes
- `lib/night.ts`: session math, tested by `node --test lib/night.test.ts`
- `lib/redeye.ts`: rule inspection, per-version quotes, receipt reader
- `lib/shared/src.ts`: loads `../src` (the agent's data, signals and execution modules) with Node's native TypeScript loader
- `content/proof/`: the recorded candles and the real-price table behind `/proof`

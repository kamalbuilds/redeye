# Redeye web

The desk for Redeye, an earnings-night agent for people in India, Singapore and Southeast Asia who hold US stocks. US companies report at 4 pm in New York, which is 1:30 am in Mumbai. You write a rule in plain English before bed. Redeye watches every tokenized version of the stock on BNB Chain (Ondo, bStocks, xStocks) through US after-hours and acts on the best one that can trade.

## What the web app does

- **Night strip (`/`)**: a 24 hour band in Mumbai or Singapore time with the US premarket, regular and after-hours sessions laid over it from New York session math (daylight-saving correct), the sleep hours shaded, a live now marker, and the Binance market status beside it.
- **Order slip**: type "if TSLA drops 8% buy $6". The rule is parsed against a strict schema (exact pattern match first, Claude as fallback when `ANTHROPIC_API_KEY` is set) and prints back as the slip's filled fields with a tear-off stub carrying the rule id.
- **Price ladder**: every Ondo, bStocks and xStocks token of the ticker at its live per-share price, against the last close and the trigger, each marked tradable or not with the reason, from a real quote request at the size of your rule.
- **Morning receipts**: the agent's `receipts.jsonl` as a stack of slips, newest on top, with the outcome, the reason, the token chosen and a BscScan link when a transaction exists.
- **Replay (`/proof`)**: Tesla's 22 July 2026 earnings night on a scrubbable Mumbai clock, TSLAon and TSLAB against the real after-hours price, with the full data table.

## Run it

From this directory:

```bash
npm install && npm run dev
```

The server reads `../.env` (the repo root) for `BINANCE_W3_API_KEY` and `BINANCE_W3_API_SECRET`. Keys stay in the Node server process and are never sent to the browser. The page quotes and reads; it never signs.

State is read from `../data` by default, the same directory the CLI writes. Set `REDEYE_DATA_DIR` to an absolute path to read a different state directory.

```bash
npm run build && npm start   # production build
```

## Layout

- `app/page.tsx`, `app/proof/page.tsx`, `app/api/rule/route.ts`, `app/api/status/route.ts`: the routes
- `lib/night.ts`: session math, tested by `node --test lib/night.test.ts`
- `lib/redeye.ts`: rule inspection, per-version quotes, receipt reader
- `lib/shared/src.ts`: loads `../src` (the agent's data, signals and execution modules) with Node's native TypeScript loader
- `content/proof/`: the recorded candles and the real-price table behind `/proof`

# Spike: do tokenized stock versions agree on earnings night?

Claim tested: on an earnings release, the bStocks and Ondo versions of the same stock on BSC diverge by more than 2% for more than one hour.

Result: REFUTED on one event (TSLA, reported 2026-07-22 after the close). n=1.

An earlier version of this file reported a 6.8% gap. That number was a join error: the two price series were pasted side by side by row number, and TSLAB has missing hours, so rows from different hours were compared. Joined on timestamp, the gap never exceeds 0.66%.

Sources:
- Tokens: public kline endpoint `https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/dex/market/token/kline/ai`, chainId 56, interval 1h, startTime 2026-07-22T18:00Z, called 2026-10-11. Raw rows in `tsla-earnings-2026-07-23.tsv` (22 TSLAon rows, 20 TSLAB rows). Candle `t` is the open time.
- Underlying: `https://query1.finance.yahoo.com/v8/finance/chart/TSLA?interval=1h&includePrePost=true`, same window.

TSLAon `0x2494b603319d4d9f9715c9f4496d9e0364b59d93`, TSLAB `0x5b1910eaad6450e50f816082aa078c41f10c292f`.

| UTC | TSLA (Yahoo, extended hours) | TSLAon | TSLAB | on vs B |
|---|---|---|---|---|
| 2026-07-22 20:00 (after-hours) | 364.51 | 364.65 | 364.76 | -0.03% |
| 2026-07-22 21:00 | 358.48 | 358.38 | 357.87 | +0.14% |
| 2026-07-23 08:00 (premarket) | 353.13 | 352.97 | 353.23 | -0.07% |
| 2026-07-23 11:00 | 349.40 | 347.47 | 349.78 | -0.66% |
| 2026-07-23 12:00 | 345.90 | 345.53 | 345.13 | +0.12% |
| 2026-07-23 13:00 / 13:30 open | 341.09 / 323.92 | 326.71 | 328.51 | -0.55% |
| 2026-07-23 14:00 | | 323.45 | 323.49 | -0.01% |

What the data does show:
- Both versions tracked the real stock's after-hours and premarket prices within about 0.5% every hour.
- 00:00 to 07:00 UTC, when there is no US session in the Yahoo data, both tokens sat at 357 to 361.
- The earnings reaction reached the tokens in three steps: after-hours (20:00 to 21:00 UTC, 1:30 to 2:30am IST), premarket (08:00 UTC onward), and the open (13:30 UTC, 7pm IST).

Consequence for the product: there is no cross-issuer earnings arbitrage to sell. The defensible claim is narrower. Tokenized stocks reprice during US after-hours, which is the middle of the night in India and Singapore, and there is no on-chain limit or conditional order for them on BSC. An agent that holds a user's rule and executes it in that window does something the user cannot do asleep.

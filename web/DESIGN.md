# DESIGN.md

Hallmark catalog theme: **Lumen, Night Foundry drop**, accent retuned from molten brass to a sodium street lamp. Genre: atmospheric. Macrostructure: bespoke apparatus page, a 24 hour night strip as the instrument, then an order slip beside a price ladder, then a stack of receipts. Nav archetype: N9 edge-aligned (wordmark left, two mono links right, one hairline). Footer archetype: Ft5 statement.

Audience: people in India and Singapore who hold US stocks and sleep through the US session. Use: leave a rule before bed, read how it was parsed, see which tokenized version can trade, read the morning receipt. Tone: technical and calm, the page you open at 11 pm.

Name: Redeye, defined once as `REDEYE_NAME` in `lib/redeye.ts`. Routes: `/` (night strip, order slip, price ladder, receipts), `/proof` (night replay of TSLA, 22 to 23 July 2026), `POST /api/rule`, `GET /api/status`. Session math lives in `lib/night.ts` with its test in `lib/night.test.ts`.

## Tokens (OKLCH, declared in app/globals.css)

| Token | Value | Role |
|---|---|---|
| night | oklch(18% 0.025 262) | canvas, night ink |
| night-2 | oklch(22% 0.026 262) | strip plate, chart plate |
| night-3 | oklch(27% 0.028 262) | raised hover |
| line, line-2 | oklch(96% 0.006 262 / 0.10, 0.20) | hairlines |
| fg, fg-2, fg-3 | oklch(95%, 78%, 66% ... 262) | text, secondary, labels (6.1:1 on night) |
| sodium | oklch(80% 0.165 72) | the one accent: "can act" and "now" |
| paper, paper-ink | oklch(91% 0.03 88), oklch(25% 0.02 60) | order slips and receipts, the only light objects |
| series-bstocks | oklch(74% 0.09 235) | TSLAB line, data only |
| series-real | oklch(88% 0.01 262) | real price rings, data only |
| fail | oklch(72% 0.13 28) | error text with a glyph, never colour alone |

Chart palette (dataviz validator, dark mode: amber #fea91e, steel #70b4dc, bone #d6d9e0): no FAIL. Two WARN lines (low chroma on bone, steel close to bone under tritanopia) are covered by secondary encoding: the real price is drawn as rings, every series is labelled directly at its line end.

## Type

- Display and numbers: Libre Caslon Text 400, roman only. Headlines, clock, prices.
- Body: Geist.
- Slips, labels, strip readouts: Azeret Mono, tabular numerals. Labels are uppercase 11px with 0.12em tracking.
- Scale (rem): 0.6875 label, 0.8125 small, 1 body, 1.375 range label, 2 to 3.75 headline, 5.5 to 6.5 replay clock.

## Space, shape, motion

- 4pt scale, page container 1180px, 20px gutter at 375, 32px from md. Radius 2px. Depth is a hairline or, for paper only, a drop shadow.
- Motion carries meaning only: the now marker drifts (one transform per 30 seconds), the slip prints line by line then its stub tears off, the trigger line breathes when the price is within 2% of it. `prefers-reduced-motion` removes all three and the replay steps by the hour.
- Focus: 2px sodium ring, offset 2px.

## Voice

Plain English, no filler. Every number carries its source in the footer. No em dashes.

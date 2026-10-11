# DESIGN.md

Hallmark catalog theme: **Almanac** (light cool paper, mono labels, dense tabular figures), with its night edition for the one section that is about the night: the /proof chart.

Genre: editorial. Macrostructure: Index-First ruled ledger (rows, no cards). Nav archetype: N6 masthead strip (wordmark left, section links right, double rule below). Footer archetype: Ft4 dense colophon.

Audience: people in India and Singapore who hold US stocks and are asleep when the US session moves. Use: write a rule before bed, read how it was parsed and which tokenized version can trade, read the morning receipt. Tone: austere, a brokerage statement read at 6 a.m.

Name: Redeye, defined once as `REDEYE_NAME` in `lib/redeye.ts`. Routes: `/` (rule desk and receipts), `/proof` (earnings-night chart), `POST /api/rule`. Shared UI lives in `components/shared/` and `components/ui/`.

## Tokens

| Token | Value | Role |
|---|---|---|
| paper | #ECEFF1 | page |
| paper-2 | #E1E6E9 | band, hover row |
| rule | #BFC8CE | hairlines |
| ink | #121C26 | text, primary surface for numerals |
| ink-2 | #3A4856 | secondary text |
| ink-3 | #566574 | muted text, labels (4.9:1 on paper) |
| signal | #0E6B5A | the one accent: primary action, live marker |
| signal-ink | #F3F7F6 | text on signal |
| warn | #8A5A00 | state text with a glyph, never color alone |
| stop | #9A3A2B | state text with a glyph, never color alone |
| night | #101822 | proof band surface |
| night-2 | #182331 | proof band plot area |
| night-rule | #2A3846 | proof band hairlines |
| bone | #E6E3D8 | text on night |
| bone-2 | #A3AFBA | muted text on night |

Chart palette (validated with the dataviz validator, dark mode, surface #101822, all five checks PASS): Ondo #BE862B, bStocks #5C8FE0, real after-hours price #2FA88B. Real price is drawn as 8px markers with a 2px surface ring, tokens as 2px lines.

## Type

- Display: Spectral 300/400, roman only. Statement headlines and section heads.
- Body and UI: Instrument Sans.
- Figures and labels: Geist Mono, tabular numerals in every column of numbers. Large single figures use Instrument Sans proportional.
- Scale (rem): 0.75 label, 0.875 small, 1 body, 1.25, 1.75, 2.75 display. Measure 62ch max.

## Space, shape, motion

- 4pt scale. Page container 1180px, 20px gutter at 375, 32px from md.
- Radius 4px everywhere. No shadows. Depth is a hairline or a paper-2 band.
- Motion: opacity and transform only, 120ms to 180ms, `ease-out`. One entrance (ledger rows rise 6px). `prefers-reduced-motion` removes it.
- Focus: 2px signal ring, offset 2px, shown instantly.

## Voice

Plain English, first person never, no filler adjectives. Numbers always carry their source and time in the colophon. No em dashes.

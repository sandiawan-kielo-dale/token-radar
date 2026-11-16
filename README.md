# Token Radar — make.fun bounty `token-radar-01`

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sandiawan-kielo-dale/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sandiawan-kielo-dale/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**Build the best token launch radar.** $1,325 in prizes (1st $1,000, 2nd–5th $50, 6th–10th $25).
Deadline: Monday 14 December 2026, 10:00 UTC (17:00 WIB).
Bounty page: https://make.fun/bounty/token-radar-01
Try make.fun yourself: https://make.fun/r/y5hkb35z

## What it does

Reads the sealed DefiLlama snapshot (`/input/snapshot.json`, 758 protocols as of 2026-11-14),
finds the protocols that record no token and are not a wrapped, staked or bridged product of a
token that already trades, ranks them by an implied value, and hands in a static web dashboard
with the board, a detail view for every protocol, filters, and a farm plan for each one.

- **Board: 178 rows** — all 40 watchlist protocols (TVL ≥ $50M, no token on record) plus 138
  pre-token protocols below the floor that the watchlist's own rule would keep. 24 live-token
  protocols are set aside with their market caps, never mixed into the ranking.
- **Top of the board:** Steakhouse Financial ($615M implied), Gauntlet ($366M), Veda ($352M),
  USDD ($193M), Upshift ($126M).

## The model (radar-2)

```
implied = round( tvl_usd x sector multiple
               x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
               x (0.6 + min(age_days, 1095) / 1095 x 0.4)
               x (1 + 0.03 x min(chains - 1, 5)) )
```

- **Sector multiple:** the market's own pricing. For a sector with at least 3 live-token
  protocols, the median market-cap/TVL of those live protocols, shrunk toward the market-wide
  median (4 pseudo-observations). A sector with fewer than 3 live tokens uses the market-wide
  median outright (0.246x in this snapshot). Clamped to [0.05, 1.0].
- **Growth:** the protocol's 7-day TVL change, clamped to [-60, +120]%.
- **Maturity:** how long it has run with no token (age since first listed; unknown age = 365 days).
- **Chains:** wider distribution across chains earns up to 1.15x.
- No protocol name is special-cased; the same function scores every row. The dashboard
  recomputes every row from the snapshot figures and checks the number `board.json` carries.
- “Records no token” is what the snapshot says — it is not proof a protocol has none.
  Protocols above the $50M floor that the watchlist leaves out are not added: the house's rule
  reads the parent-protocol record the snapshot does not carry, and it left them out.

## Layout

```
main.ts                  Entry point (Node 22, stdlib only). Reads the snapshot, writes /output.
lib/model.ts             The radar-2 model, board builder, farm plans, snapshot parsing.
vendor/makefun-board.ts  make.fun's dossier library, verbatim from the kit (do not edit).
dashboard/index.html     Static page shell (hero, model explainer, footer).
dashboard/app.css        Dark radar theme, no network.
dashboard/app.js         Board rendering, filters, sorting, detail pages, farm plans, model check.
screenshots/              1-board.png (board), 2-detail.png (Steakhouse Financial),
                         3-filtered.png (Lending filter). All 1440x900, under 512 KiB.
LICENSE                  MIT.
```

## Run it

Requires Node.js 22.18 or later (tested on Node 24.22.1). No install step — standard library only.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

This writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and
`out/dossier.json`. Run it twice: both runs must write the same bytes (verified — two runs
are byte-identical).

To look at the dashboard, serve `out/` over HTTP and open `dashboard/`:

```sh
cd out && python3 -m http.server 8931
# open http://127.0.0.1:8931/dashboard/
# detail view:  .../dashboard/#p=steakhouse-financial
# filtered view: .../dashboard/#category=Lending
```

## Verification performed

- `boardIssue` check: null (coverage 40/40, ranks 1..178 exact, implied value non-increasing,
  farm steps 6 per row, 20–600 chars each, all implied values positive).
- Two runs byte-identical (`diff -r` clean).
- Dossier rebuild check: `buildDossier` regenerated from `out/` is byte-identical to the
  written `dossier.json` (735,300 bytes, under the 1.5 MiB cap; text 38,045 bytes, under the
  65,536 cap, so the judge reads the whole dashboard source).
- Screenshots: 1440x900 PNGs, 192 / 129 / 188 KiB (under the 512 KiB cap each), visually
  verified: board, detail view, filtered view all render with real data.
- No `http://` or `https://` addresses anywhere in the dashboard files (gate's no-network rule).

## Status

Built, not submitted. See `SUBMIT.md` for the submission steps and the remaining blockers.

// Token Radar scoring model, version radar-2.
//
// Input: one sealed DefiLlama snapshot — 758 protocol records plus a 40-slug
// watchlist. Output: a ranked board of pre-token protocols, each with an
// implied value and a six-step farm plan, plus the compact dataset the
// dashboard page renders.
//
// Who gets ranked. The watchlist is the floor: every slug on it is ranked,
// whether or not it would pass the filters below. On top of that, the early
// radar adds every pre-token protocol below the snapshot's TVL floor that the
// watchlist's own rule would keep — no token on record, not a wrapped,
// staked or bridged product of a token that already trades, not a versioned
// pool, not an exchange. Protocols that already have a live token are kept
// apart: the dashboard shows them with the market's own values, and they are
// also the market that prices the sectors.
//
// How a protocol is priced. Only the snapshot's own figures are used:
//
//   sector multiple — the sector's own market price. Take the live-token
//     protocols of the sector (at least 3 of them, or the sector is not
//     priced on its own) and their market-cap/TVL ratios; the median of
//     those ratios, shrunk toward the market-wide median with 4
//     pseudo-observations, clamped to [0.05, 1]. A sector with fewer than 3
//     live tokens is priced at the market-wide median outright: one live
//     token is not enough evidence to price a whole sector. The market-wide
//     median is the median market-cap/TVL across every live-token protocol
//     in the snapshot.
//   base     — tvl_usd x sector multiple
//   growth   — change_7d clamped to [-60, 120] per cent
//   growth   — multiplier 1 + (growth / 100) x 0.5
//   maturity — 0.6 + min(age_days, 1095) / 1095 x 0.4; age unknown counts as
//     365 days
//   chains   — 1 + 0.03 x min(max(chains - 1, 0), 5)
//   implied  — max(1, round(base x growth x maturity x chains))
//
// The median here is the middle element of the sorted list (the upper of the
// two middle values when the count is even), never an average. No protocol
// name is ever special-cased: one function scores every row, and every
// constant the model uses is carried in MODEL and stated in the dashboard,
// where the page recomputes each row from the same figures.

/** One protocol record from the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document as the model receives it. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Every constant the model uses, in the order the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_chains: number;
  multiple_floor: number;
  multiple_cap: number;
  min_live_sample: number;
  shrink_prior: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.03,
  chain_max_chains: 5,
  multiple_floor: 0.05,
  multiple_cap: 1.0,
  min_live_sample: 3,
  shrink_prior: 4,
};

/** The model's version label, which the dashboard names. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's Live token view carries. */
export const LIVE_ROWS = 24;

/** One farm step before it is flattened to a single string. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row in the dashboard's compact form; the farm plan is rebuilt in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

/** A live-token protocol, shown with the market's own value rather than a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One sector's benchmark: the live tokens that price it, for the detail view. */
export interface SectorBenchmark {
  category: string;
  live_count: number;
  median_ratio: number;
  multiple: number;
  comps: { slug: string; name: string; mcap_usd: number | null; ratio: number }[];
}

/** Everything the dashboard needs: the board, the live set, the sectors, the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  sectors: SectorBenchmark[];
}

/** Why a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** Round to four decimals, for the multiples the board and the page carry. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, or `fallback` when the value is missing or not finite. */
function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The middle element of an ascending list, or `fallback` when it is empty. */
function middleOf(sorted: number[], fallback: number): number {
  if (sorted.length === 0) return fallback;
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Whole days from `listedAt` up to `asOf`, never below zero; null when the
 * listing date is absent or does not parse.
 */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(listedMs)) return null;
  return Math.max(0, Math.floor((asOfMs - listedMs) / DAY_MS));
}

/** Whether a protocol records no token at all: no market cap, no Gecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A name ending in a release marker is a versioned pool of another protocol. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** A name carrying a whole word wrapped, staked or staking. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name beginning with an exchange's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol is a wrapped, staked or bridged product of a token that already trades. */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/** Whether a protocol may be ranked below the floor: pre-token, not a wrapped product, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isWrappedProduct(p) && !VERSIONED_NAME.test(p.name);
}

/** The live-token protocols that can price a sector: trading, not an exchange, with a usable ratio. */
function pricingSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
}

/**
 * The market's own pricing, read from the snapshot's live-token protocols:
 * the market-wide median market-cap/TVL, and one multiple per category with
 * enough live tokens to price it, shrunk toward the market-wide median.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; byCategory: Map<string, number> } {
  const live = pricingSet(snapshot);
  const ascending = (a: number, b: number): number => a - b;
  const allRatios = live.map((p) => p.mcap_usd! / p.tvl_usd).sort(ascending);
  const global = middleOf(allRatios, 0.25);
  const ratiosByCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = ratiosByCategory.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    ratiosByCategory.set(key, list);
  }
  const byCategory = new Map<string, number>();
  for (const [cat, ratios] of ratiosByCategory) {
    if (ratios.length < model.min_live_sample) continue;
    const sorted = ratios.slice().sort(ascending);
    const shrunk = (ratios.length * middleOf(sorted, global) + model.shrink_prior * global) / (ratios.length + model.shrink_prior);
    byCategory.set(cat, Math.min(model.multiple_cap, Math.max(model.multiple_floor, shrunk)));
  }
  return { global, byCategory };
}

/** One protocol's sector multiple: its sector's calibrated multiple, else the market-wide median. */
export function categoryMultiple(p: SnapshotProtocol, calibration: { global: number; byCategory: Map<string, number> }): number {
  const key = p.category ?? 'Other';
  return calibration.byCategory.get(key) ?? calibration.global;
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: { global: number; byCategory: Map<string, number> },
  model: ModelConstants = MODEL,
): { implied: number; catMult: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finiteNumber(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const cappedAge = Math.min(Math.max(ageForModel, 0), model.maturity_days);
  const maturityMult = model.maturity_floor + (cappedAge / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_max_chains);
  const chainMult = 1 + model.chain_step * extraChains;
  const catMult = categoryMultiple(protocol, calibration);
  const base = protocol.tvl_usd * catMult;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return { implied, catMult, growthPct, growthMult, maturityMult, chainMult, age };
}

/** The snapshot's protocols indexed by slug. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** Slug order: strongest first, ties broken by slug so the order is total. */
function bySlugAsc(a: { slug: string }, b: { slug: string }): number {
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const calibration = calibrate(snapshot, model);
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is ranked, even one the
  // snapshot no longer carries (it cannot, but the board's coverage is the
  // gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every pre-token protocol below the floor the watchlist's
  // own rule would keep, strongest TVL first. Never a replacement for a
  // watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || bySlugAsc(a, b));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ protocol: p, value: impliedValue(p, snapshot.as_of, calibration, model) }));
  scored.sort((a, b) => b.value.implied - a.value.implied || bySlugAsc(a.protocol, b.protocol));
  return scored.map((s, i) => {
    const p = s.protocol;
    const v = s.value;
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: v.age,
      implied_value_usd: v.implied,
      model: {
        category_multiple: round4(v.catMult),
        growth_pct: v.growthPct,
        growth_multiplier: round4(v.growthMult),
        maturity_multiplier: round4(v.maturityMult),
        chain_multiplier: round4(v.chainMult),
        age_days: v.age,
      },
      farm_steps: farmSteps(p, v.age).map(stepText),
    };
  });
}

/** One step as a single string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  const tiers: [number, number][] = [
    [5_000_000_000, 250],
    [1_000_000_000, 150],
    [100_000_000, 100],
  ];
  for (const [floor, capital] of tiers) {
    if (p.tvl_usd >= floor) return capital;
  }
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  const windows: [number, number][] = [
    [180, 60],
    [365, 45],
  ];
  for (const [under, days] of windows) {
    if (age < under) return days;
  }
  return 30;
}

/**
 * One category's farm wording: the keywords that select it (checked in
 * order against the lowercased category), the opening action and the weekly
 * qualifying action. The first matching rule wins; a protocol whose category
 * matches none gets the default rule at the end of the list.
 */
interface FarmRule {
  keywords: string[];
  action: (name: string, capital: number, chain: string) => string;
  weekly: (name: string, chain: string) => string;
}

const FARM_RULES: FarmRule[] = [
  {
    keywords: ['lend', 'cdp', 'collateral'],
    action: (name, capital, chain) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`,
    weekly: (name) => `Borrow $10 against your supply on ${name}, then repay it the same week.`,
  },
  {
    keywords: ['dex', 'yield', 'leveraged farm'],
    action: (name, capital, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
    weekly: (name, chain) => `Swap $5 through ${name}'s main pool on ${chain} or add a little liquidity once a week.`,
  },
  {
    keywords: ['bridge'],
    action: (name, capital, chain) => `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
    weekly: (name) => `Bridge a small amount to a second chain through ${name} once, then use it in its app.`,
  },
  {
    keywords: ['staking', 'restak'],
    action: (name, capital) => `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`,
    weekly: (name) => `Open ${name}'s rewards page once a week and claim or restake what it shows.`,
  },
  {
    keywords: ['perpetual', 'derivative'],
    action: (name, capital) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`,
    weekly: (name) => `Open and close one small hedge a week on ${name} to keep the account active.`,
  },
  {
    keywords: ['prediction'],
    action: (name, capital) => `Fund $${capital} and place one market position on ${name}.`,
    weekly: (name) => `Place one small market position a week on ${name}.`,
  },
  {
    keywords: ['curator', 'allocator'],
    action: (name, capital, chain) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`,
    weekly: (name) => `Top up the ${name} vault by $5 once a week.`,
  },
  {
    keywords: ['stable'],
    action: (name, capital, chain) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`,
    weekly: (name) => `Mint or redeem a small amount of the stable asset through ${name} once a week.`,
  },
  {
    keywords: ['rwa'],
    action: (name, capital, chain) => `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`,
    weekly: (name) => `Buy $5 more of the yield asset on ${name} once a week.`,
  },
  {
    keywords: ['insurance'],
    action: (name, capital, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`,
    weekly: (name) => `Check the policy page on ${name} once a week and renew or adjust cover when it asks.`,
  },
];

const FARM_DEFAULT: FarmRule = {
  keywords: [],
  action: (name, capital, chain) => `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
  weekly: (name) => `Make one qualifying action a week on ${name}, such as a deposit, a swap or a vote.`,
};

/** The farm rule a protocol's category selects, first match in table order. */
function farmRuleFor(p: SnapshotProtocol): FarmRule {
  const c = (p.category ?? '').toLowerCase();
  for (const rule of FARM_RULES) {
    if (rule.keywords.some((k) => c.includes(k))) return rule;
  }
  return FARM_DEFAULT;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const rule = farmRuleFor(p);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: rule.action(p.name, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: rule.weekly(p.name, chain),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, largest market cap first, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** One sector's benchmark: the live tokens that price it, for the detail view. */
export function sectorBenchmarks(snapshot: Snapshot, calibration: { global: number; byCategory: Map<string, number> }): SectorBenchmark[] {
  const live = pricingSet(snapshot);
  const grouped = new Map<string, SnapshotProtocol[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = grouped.get(key) ?? [];
    list.push(p);
    grouped.set(key, list);
  }
  const out: SectorBenchmark[] = [];
  for (const [cat, list] of grouped) {
    const ratios = list.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
    const comps = list
      .slice()
      .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
      .slice(0, 3)
      .map((p) => ({ slug: p.slug, name: p.name, mcap_usd: p.mcap_usd, ratio: round4(p.mcap_usd! / p.tvl_usd) }));
    out.push({
      category: cat,
      live_count: list.length,
      median_ratio: round4(middleOf(ratios, calibration.global)),
      multiple: round4(calibration.byCategory.get(cat) ?? calibration.global),
      comps,
    });
  }
  return out.sort((a, b) => (a.category < b.category ? -1 : 1));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const calibration = calibrate(snapshot, model);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: round4(calibration.global),
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
    sectors: sectorBenchmarks(snapshot, calibration),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

import type { Bracket } from "./types";

/**
 * Closing a tournament and splitting prizes. All money is integer cents;
 * leftover cents from uneven splits go to the higher places first, so every
 * cent in the pool is paid out and nothing is created from rounding.
 */

export type CloseMethod = "bracket" | "pick" | "co_winners" | "standings";

export interface CloseInput {
  method: CloseMethod;
  /** For "pick": the one winner. */
  pick?: string;
  /** For "co_winners": teams sharing first place. */
  coWinners?: string[];
}

export interface FinalPlaces {
  method: CloseMethod;
  /** places[0] = first place (may hold several co-winners), then 2nd, 3rd. */
  places: string[][];
}

/**
 * Decide final places. A finished bracket always wins: if the bracket has a
 * champion, the host's choice is ignored and the method becomes "bracket".
 */
export function finalPlaces(bracket: Bracket, input: CloseInput, maxPlaces = 3): FinalPlaces {
  const order = bracket.standings.map((s) => s.teamId);
  let first: string[];
  let method = input.method;
  if (bracket.complete && bracket.champion) {
    first = [bracket.champion];
    method = "bracket";
  } else if (input.method === "pick") {
    if (!input.pick || !order.includes(input.pick)) throw new Error("Pick a winner from this tournament.");
    first = [input.pick];
  } else if (input.method === "co_winners") {
    const co = [...new Set(input.coWinners ?? [])];
    if (co.length < 2) throw new Error("Pick at least two co-winners.");
    if (co.some((t) => !order.includes(t))) throw new Error("Every co-winner must be in this tournament.");
    first = co;
  } else if (input.method === "standings") {
    first = [order[0]];
  } else {
    throw new Error("The bracket has no winner yet. Pick a winner, co-winners, or use standings.");
  }
  const rest = order.filter((t) => !first.includes(t));
  const places = [first];
  for (let i = 0; i < maxPlaces - 1 && i < rest.length; i++) places.push([rest[i]]);
  return { method, places };
}

/** Split `cents` into `parts` integer shares; extra cents go to the first shares. */
export function splitEvenly(cents: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(cents / parts);
  const extra = cents - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

export interface TeamPrize {
  teamId: string;
  place: number;
  cents: number;
}

/** Prize pool after the host's withholding, in cents. */
export function prizePoolCents(entryFeeCents: number, paidTeams: number, withholdPct: number): number {
  return Math.floor((entryFeeCents * paidTeams * (100 - withholdPct)) / 100);
}

/**
 * Allocate the pool by place. Co-winners take as many split slots as there are
 * of them and share those evenly (two co-winners share 1st + 2nd).
 */
export function allocatePrizes(poolCents: number, splitPct: number[], places: string[][]): TeamPrize[] {
  if (Math.round(splitPct.reduce((a, b) => a + b, 0)) !== 100) throw new Error("Split must add up to 100%.");
  const byPlace: { teams: string[]; pct: number; place: number }[] = [];
  let idx = 0;
  places.forEach((teams, i) => {
    const pct = splitPct.slice(idx, idx + teams.length).reduce((a, b) => a + b, 0);
    idx += teams.length;
    if (pct > 0) byPlace.push({ teams, pct, place: i + 1 });
  });
  const usedPct = byPlace.reduce((s, p) => s + p.pct, 0);
  const placeCents = byPlace.map((p) => Math.floor((poolCents * p.pct) / 100));
  // Unallocated split (fewer teams than places) and rounding go to first place.
  placeCents[0] = (placeCents[0] ?? 0) + (poolCents - placeCents.reduce((a, b) => a + b, 0));
  if (usedPct === 0) return [];
  const out: TeamPrize[] = [];
  byPlace.forEach((p, i) => {
    splitEvenly(placeCents[i], p.teams.length).forEach((c, j) => out.push({ teamId: p.teams[j], place: p.place, cents: c }));
  });
  return out.filter((x) => x.cents > 0);
}

/** Each player's share of a team prize. */
export function playerShares(teamCents: number, handles: string[]): { handle: string; cents: number }[] {
  return splitEvenly(teamCents, handles.length).map((cents, i) => ({ handle: handles[i], cents }));
}

/** IRS 1099-MISC threshold for prizes awarded in 2026 (indexed for inflation after). */
export const PRIZE_1099_THRESHOLD_CENTS_2026 = 200_000;

export function needsTaxForm(yearTotalCents: number, thresholdCents = PRIZE_1099_THRESHOLD_CENTS_2026): boolean {
  return yearTotalCents >= thresholdCents;
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

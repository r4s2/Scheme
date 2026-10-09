import { groupSize, pairKey } from "./bracket";
import { averageScore } from "./games";
import type { FormatId, TournamentState } from "./types";

/** Deterministic PRNG (mulberry32) so shuffles are reproducible in tests and logs. */
export function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Teams appearing in any result key (handles "L:", "GF:" and "P:" prefixes). */
function teamsWithResults(state: Pick<TournamentState, "results">): Set<string> {
  const teams = new Set<string>();
  for (const k of Object.keys(state.results)) {
    const pair = k.includes(":") ? k.slice(k.indexOf(":") + 1) : k;
    for (const x of pair.split("|")) teams.add(x);
  }
  return teams;
}

/**
 * Slot indexes that can't move because a confirmed result depends on them.
 * Elimination and Swiss: both slots of a decided first-round pairing.
 * Round robin and groups: any team that has played.
 */
export function lockedSlots(state: Pick<TournamentState, "results">, slots: string[], format: FormatId): Set<number> {
  if (format === "rr" || format === "groups") {
    const played = teamsWithResults(state);
    return new Set(slots.map((s, i) => (played.has(s) ? i : -1)).filter((i) => i >= 0));
  }
  const locked = new Set<number>();
  for (let i = 0; i < slots.length; i += 2) {
    if (state.results[pairKey(slots[i], slots[i + 1])]) {
      locked.add(i);
      locked.add(i + 1);
    }
  }
  return locked;
}

/**
 * The format can change only while every result is a round-one pairing of the
 * current slots, so all results carry over to the new format.
 */
export function canTransform(state: Pick<TournamentState, "results" | "slots">): boolean {
  const firstRound = new Set<string>();
  for (let i = 0; i < state.slots.length; i += 2) firstRound.add(pairKey(state.slots[i], state.slots[i + 1]));
  return Object.keys(state.results).every((k) => !k.includes(":") && firstRound.has(k));
}

/** Standard bracket seed order (1 v 16, 8 v 9, ...) for `count` pairings. */
export function bracketOrder(count: number): number[] {
  if (count & (count - 1)) return Array.from({ length: count }, (_, i) => i);
  let order = [1];
  while (order.length < count) {
    const len = order.length * 2;
    order = order.flatMap((s) => [s, len + 1 - s]);
  }
  return order.map((x) => x - 1);
}

/** Shuffle every unlocked slot. Guarantees at least one change when possible. */
export function randomizeSlots(state: TournamentState, slots: string[], format: FormatId, seed: number): string[] {
  const locked = lockedSlots(state, slots, format);
  const free = slots.map((_, i) => i).filter((i) => !locked.has(i));
  let out = slots;
  for (let attempt = 0; attempt < 6; attempt++) {
    const names = free.map((i) => slots[i]);
    const rand = seededRandom(seed + attempt * 97);
    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [names[i], names[j]] = [names[j], names[i]];
    }
    out = [...slots];
    free.forEach((s, k) => (out[s] = names[k]));
    if (out.some((n, i) => n !== slots[i])) break;
  }
  return out;
}

/**
 * Seed by verified average rank. Elimination and Swiss: strongest open team
 * meets the weakest, placed in standard bracket order so top seeds meet late.
 * Groups: snake teams across groups so every group has a similar average.
 */
export function seedSlots(state: TournamentState, slots: string[], format: FormatId): string[] {
  const locked = lockedSlots(state, slots, format);
  const avg = (id: string) => averageScore(state.teams[id]);
  if (format === "rr") return slots;
  if (format === "groups") {
    if (locked.size) return slots;
    const n = slots.length;
    const size = groupSize(n);
    const g = n / size;
    const sorted = [...slots].sort((a, b) => avg(b) - avg(a));
    const out: string[] = new Array(n);
    const fill = new Array(g).fill(0);
    sorted.forEach((id, i) => {
      const row = Math.floor(i / g);
      const pos = i % g;
      const gi = row % 2 ? g - 1 - pos : pos;
      out[gi * size + fill[gi]++] = id;
    });
    return out;
  }
  const freePairs: number[] = [];
  for (let i = 0; i < slots.length; i += 2) if (!locked.has(i)) freePairs.push(i);
  const ids = freePairs.flatMap((i) => [slots[i], slots[i + 1]]).sort((a, b) => avg(b) - avg(a));
  const k = ids.length;
  const pairs: [string, string][] = [];
  for (let i = 0; i < k / 2; i++) pairs.push([ids[i], ids[k - 1 - i]]);
  const order = bracketOrder(pairs.length);
  const out = [...slots];
  freePairs.forEach((pos, idx) => {
    const p = pairs[order[idx]];
    out[pos] = p[0];
    out[pos + 1] = p[1];
  });
  return out;
}

export type SwapResult = { ok: true; slots: string[] } | { ok: false; reason: string };

/** Swap two slots unless either is locked by a result. */
export function swapSlots(state: TournamentState, a: number, b: number): SwapResult {
  if (a === b) return { ok: false, reason: "Pick two different slots." };
  const locked = lockedSlots(state, state.slots, state.format);
  if (locked.has(a) || locked.has(b)) return { ok: false, reason: "That team has a confirmed result, so it is locked in place." };
  const slots = [...state.slots];
  [slots[a], slots[b]] = [slots[b], slots[a]];
  return { ok: true, slots };
}

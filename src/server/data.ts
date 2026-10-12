import "server-only";
import { cache } from "react";
import { buildBoards } from "./summary";
import { getStore } from "./store";

/**
 * Reads shared by several components on one page (the header and the page
 * itself), deduplicated per request so each runs once.
 */
/**
 * Winners and the people list change only when a tournament does, but every
 * page header and leaderboard reads them. Keep them for a short while in this
 * server process; any save made through Scheme clears them right away.
 */
const SHARED_TTL_MS = 30_000;
const shared = new Map<string, { at: number; value: Promise<unknown> }>();
function sharedRead<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = shared.get(key);
  if (hit && Date.now() - hit.at < SHARED_TTL_MS) return hit.value as Promise<T>;
  const value = load();
  shared.set(key, { at: Date.now(), value });
  value.catch(() => shared.delete(key));
  return value;
}

/** Call after any save, so the next page shows it. */
export function changed() {
  shared.clear();
}

const wins = cache(() => sharedRead("wins", () => getStore().wins()));

export const listTournaments = cache(() => getStore().list());
export const leaderboards = cache(async () => buildBoards(await wins()));
export const people = cache(() => sharedRead("people", () => getStore().people()));
export const notificationsFor = cache((handle: string) => getStore().notifications(handle));

/** Tournaments won per team name (lowercased) in one game, for hover cards. */
export const teamWins = cache(async (game: string): Promise<Record<string, number>> => {
  const out: Record<string, number> = {};
  for (const w of await wins()) if (w.game === game) out[w.team.toLowerCase()] = (out[w.team.toLowerCase()] ?? 0) + 1;
  return out;
});

import "server-only";
import { cache } from "react";
import { buildBoards } from "./summary";
import { getStore } from "./store";

/**
 * Reads shared by several components on one page (the header and the page
 * itself), deduplicated per request so each runs once.
 */
export const listTournaments = cache(() => getStore().list());
export const leaderboards = cache(async () => buildBoards(await getStore().wins()));
export const people = cache(() => getStore().people());
export const notificationsFor = cache((handle: string) => getStore().notifications(handle));

/** Tournaments won per team name (lowercased) in one game, for hover cards. */
export const teamWins = cache(async (game: string): Promise<Record<string, number>> => {
  const out: Record<string, number> = {};
  for (const w of await getStore().wins()) if (w.game === game) out[w.team.toLowerCase()] = (out[w.team.toLowerCase()] ?? 0) + 1;
  return out;
});

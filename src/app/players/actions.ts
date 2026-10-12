"use server";

import { GAMES, rankName, type GameId } from "@/engine";
import { ineligibility, rankNote, type EligibilityRules } from "@/server/registration";
import { getStore } from "@/server/store";
import { currentActor } from "@/server/session";

/** One player in a search result, with what matters for the event being entered. */
export interface PlayerHit {
  handle: string;
  /** Rank in the game searched for, or null with no linked account. */
  rank: string | null;
  verified: "api" | "self" | null;
  roles: string[];
  /** Why they can't enter the event, when rules were given. */
  blocker: string | null;
  /** A heads-up that doesn't block (outside a suggested rank range). */
  note: string | null;
  lookingForTeam: boolean;
}

const RULES = new Set(["open", "suggested", "required"]);

/**
 * Search Scheme players by handle or game account name. With a game, each hit
 * shows their rank in it; with an event's rules, whether they can enter.
 * Display only: registering checks everyone again on the server.
 */
export async function findPlayers(query: string, game?: GameId, rules?: EligibilityRules): Promise<PlayerHit[]> {
  if (!(await currentActor())) return [];
  const q = String(query ?? "").trim().slice(0, 40);
  if (!q) return [];
  const g = game && GAMES[game] ? game : undefined;
  const r =
    rules && GAMES[rules.game] && RULES.has(rules.rankRule) && Number.isFinite(rules.rankMin) && Number.isFinite(rules.rankMax)
      ? { ...rules, requirements: { minKarma: Number(rules.requirements?.minKarma) || 0, verifiedOnly: !!rules.requirements?.verifiedOnly } }
      : undefined;
  const found = await getStore().searchProfiles(q, 8);
  return found.map((p) => {
    const acct = g ? p.accounts.find((a) => a.game === g) : undefined;
    return {
      handle: p.handle,
      rank: acct && g ? rankName(g, acct.rankScore) : null,
      verified: acct?.source ?? null,
      roles: acct?.roles ?? [],
      blocker: r ? ineligibility(r, p, p.handle) : null,
      note: r ? rankNote(r, p) : null,
      lookingForTeam: p.lookingForTeam,
    };
  });
}

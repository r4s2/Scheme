import type { FormatId, GameId, Team } from "./types";

export const FORMAT_NAMES: Record<FormatId, string> = {
  single: "Single elimination",
  double: "Double elimination",
  rr: "Round robin",
  swiss: "Swiss",
  groups: "Groups → playoffs",
};

export type Publisher = "riot" | "blizzard" | "netease";

export interface GameConfig {
  id: GameId;
  name: string;
  publisher: Publisher;
  /** Rank tiers from lowest to highest. The top tier has no divisions. */
  tiers: string[];
  /** Division labels within a tier, lowest first. */
  divisions: string[];
  /** One entry per seat on a team; repeated roles mean that many seats. */
  roles: string[];
  /** Where verified ranks come from. */
  rankSource: string;
}

export const GAMES: Record<GameId, GameConfig> = {
  val: {
    id: "val",
    name: "Valorant",
    publisher: "riot",
    tiers: ["Iron", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ascendant", "Immortal", "Radiant"],
    divisions: ["1", "2", "3"],
    roles: ["Duelist", "Initiator", "Controller", "Sentinel", "Flex"],
    rankSource: "Riot API via Riot Sign On",
  },
  mr: {
    id: "mr",
    name: "Marvel Rivals",
    publisher: "netease",
    tiers: ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Grandmaster", "Celestial", "Eternity", "One Above All"],
    divisions: ["III", "II", "I"],
    roles: ["Vanguard", "Vanguard", "Duelist", "Duelist", "Strategist", "Strategist"],
    rankSource: "Self-reported with screenshot until a data provider is signed",
  },
  ow: {
    id: "ow",
    name: "Overwatch",
    publisher: "blizzard",
    tiers: ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master", "Grandmaster", "Champion"],
    divisions: ["5", "4", "3", "2", "1"],
    roles: ["Tank", "Damage", "Damage", "Support", "Support"],
    rankSource: "Public career profile (Battle.net sign-in for ownership)",
  },
  lol: {
    id: "lol",
    name: "League of Legends",
    publisher: "riot",
    tiers: ["Iron", "Bronze", "Silver", "Gold", "Platinum", "Emerald", "Diamond", "Master", "Grandmaster", "Challenger"],
    divisions: ["IV", "III", "II", "I"],
    roles: ["Top", "Jungle", "Mid", "Bot", "Support"],
    rankSource: "Riot API via Riot Sign On",
  },
};

/** Overwatch 6v6 seats, used when a host picks the 6v6 preset. */
export const OW_6V6_ROLES = ["Tank", "Tank", "Damage", "Damage", "Support", "Support"];

/** Highest score on a game's ladder (the undivided top tier). */
export function maxScore(game: GameId): number {
  const g = GAMES[game];
  return (g.tiers.length - 1) * g.divisions.length;
}

/** "Diamond 2", "Immortal 1", or the top tier name. */
export function rankName(game: GameId, score: number): string {
  const g = GAMES[game];
  const d = g.divisions.length;
  const s = Math.max(0, Math.round(score));
  if (s >= maxScore(game)) return g.tiers[g.tiers.length - 1];
  return `${g.tiers[Math.floor(s / d)]} ${g.divisions[s % d]}`;
}

/** Compact rank for tight spaces: "Dia 2", "Imm 1", or the top tier's initials. */
export function rankShortName(game: GameId, score: number): string {
  const full = rankName(game, score);
  const parts = full.split(" ");
  const top = GAMES[game].tiers[GAMES[game].tiers.length - 1];
  if (full === top || parts.length < 2) return full.length > 9 ? parts.map((w) => w[0]).join("") : full;
  return `${parts.slice(0, -1).join(" ").slice(0, 3)} ${parts[parts.length - 1]}`;
}

/** Score of the lowest division in a tier, for rank floors. */
export function tierFloor(game: GameId, tierIndex: number): number {
  return tierIndex * GAMES[game].divisions.length;
}

/** Score of the highest division in a tier, for rank ceilings. */
export function tierCeiling(game: GameId, tierIndex: number): number {
  const d = GAMES[game].divisions.length;
  return Math.min(tierIndex * d + d - 1, maxScore(game));
}

export function averageScore(team: Pick<Team, "players">): number {
  if (team.players.length === 0) return 0;
  return team.players.reduce((sum, p) => sum + p.score, 0) / team.players.length;
}

/** How many seats each role has, e.g. { Vanguard: 2, Duelist: 2, Strategist: 2 }. */
export function roleCounts(roles: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of roles) counts[r] = (counts[r] ?? 0) + 1;
  return counts;
}

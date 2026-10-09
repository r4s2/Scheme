import type { GameId } from "@/engine";

/** Per-game lobby setup shown on match pages. Scheme doesn't create lobbies. */
export const LOBBY_STEPS: Record<GameId, string[]> = {
  val: [
    "Create a Custom Game with Tournament Mode on and cheats off.",
    "Bo3 map veto: the higher seed bans first, then ban, ban, pick, pick, ban, ban. The last map left is the decider.",
  ],
  mr: [
    "Create a Tournament Room: Play, Change Mode, Custom Game, Tournament Room, Create.",
    "Use Tournament (Basic) ban/pick, the same order used in official play.",
  ],
  ow: [
    "Create a Custom Game using the current Competitive ruleset.",
    "Map 1 is picked by the higher seed; the loser of each map picks the next.",
  ],
  lol: [
    "Join with the tournament code on this page. It sets up Summoner's Rift with Tournament Draft and reports the result automatically.",
    "The higher seed takes blue side in game 1; the loser of each game picks side after.",
  ],
};

import { GAMES, pairKey, type Team, type TournamentState } from "@/engine";

/**
 * "Friday Night Spike" from the prototype: 8 Valorant teams, single
 * elimination, two results in. Used by /demo so the bracket can be seen
 * without a database.
 */
export function sampleTournament(): TournamentState {
  const roster: [string, number][] = [
    ["Tilt Proof", 19],
    ["Eco Round", 11],
    ["Night Shift", 16],
    ["Paper Tigers", 13],
    ["Low Ground", 18],
    ["Second Wind", 14],
    ["Hot Coffee", 17],
    ["Backline Bandits", 15],
  ];
  const handles = "ember vexa moth kiro tallulah vanta sundew ozzy pixelwitch b0lt harbor juno ketchup ruin nimbus pebble quokka dandelion fizz grit sable lumen cobra wren tofu quill staticc haze rook zephyr glint crumb delta iris koi lynx mint nox pyre orbitz".split(" ");
  const offsets = [2, 0, 1, -1, -2];
  const teams: Record<string, Team> = {};
  roster.forEach(([name, rank], i) => {
    const id = name.toLowerCase().replace(/\s+/g, "-");
    teams[id] = {
      id,
      name,
      captain: handles[i * 5],
      players: GAMES.val.roles.map((role, j) => ({
        handle: handles[i * 5 + j],
        score: rank + offsets[j],
        role,
        verified: "api",
        checkedIn: true,
      })),
    };
  });
  const slots = Object.keys(teams);
  return {
    format: "single",
    bestOf: 3,
    slots,
    teams,
    results: {
      [pairKey("tilt-proof", "eco-round")]: { winner: "tilt-proof", w: 2, l: 0, by: "reports", matchId: "M1" },
      [pairKey("low-ground", "second-wind")]: { winner: "low-ground", w: 2, l: 1, by: "reports", matchId: "M3" },
    },
  };
}

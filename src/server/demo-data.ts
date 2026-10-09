import { GAMES, makeSchedule, pairKey, type Player, type Team } from "@/engine";
import type { TournamentAgg } from "./model";

/**
 * Demo tournaments for local development without a database, mirroring the
 * prototype: a live Valorant event and a Marvel Rivals event in check-in.
 */
export function demoTournaments(now: Date): TournamentAgg[] {
  return [fridayNightSpike(now), saturdaySixStack()];
}

const offsets = [2, 0, 1, -1, -2, 0];

function makeTeam(id: string, name: string, roles: string[], handles: string[], rank: number, checkedIn: (i: number) => boolean = () => true, verified: Player["verified"] = "api"): Team {
  return {
    id,
    name,
    captain: handles[0],
    players: roles.map((role, j) => ({ handle: handles[j], score: rank + offsets[j], role, verified, checkedIn: checkedIn(j) })),
  };
}

function fridayNightSpike(now: Date): TournamentAgg {
  const roster: [string, number][] = [
    ["Tilt Proof", 19], ["Eco Round", 11], ["Night Shift", 16], ["Paper Tigers", 13],
    ["Low Ground", 18], ["Second Wind", 14], ["Hot Coffee", 17], ["Backline Bandits", 15],
  ];
  const handles = "ember vexa moth kiro tallulah vanta sundew ozzy pixelwitch b0lt harbor juno ketchup ruin nimbus pebble quokka dandelion fizz grit sable lumen cobra wren tofu quill staticc haze rook zephyr glint crumb delta iris koi lynx mint nox pyre orbitz".split(" ");
  const teams: Record<string, Team> = {};
  roster.forEach(([name, rank], i) => {
    const id = name.toLowerCase().replace(/\s+/g, "-");
    // Hot Coffee's captain is glint, matching the prototype's player view.
    const hs = handles.slice(i * 5, i * 5 + 5);
    if (id === "hot-coffee") hs.unshift(hs.splice(hs.indexOf("glint"), 1)[0]);
    teams[id] = makeTeam(id, name, GAMES.val.roles, hs, rank);
  });
  const started = new Date(now.getTime() - 27 * 3_600_000);
  const schedule = makeSchedule(started.toISOString(), 24, 3);
  // M2 is three hours overdue, M4 has a few hours left.
  schedule.overrides = { M4: new Date(now.getTime() + 3 * 3_600_000).toISOString() };
  return {
    id: "friday-night-spike",
    version: 1,
    name: "Friday Night Spike",
    game: "val",
    host: "kestrel",
    status: "live",
    region: "NA East",
    signupType: "team",
    allowExtensions: true,
    houseRules: ["Overtime: win by two, no cap.", "Screenshot the final scoreboard of every map."],
    entryFeeCents: 0,
    withholdPct: 0,
    payoutSplit: [60, 30, 10],
    matchWindowHours: 24,
    state: {
      format: "single",
      bestOf: 3,
      slots: Object.keys(teams),
      teams,
      results: {
        [pairKey("tilt-proof", "eco-round")]: { winner: "tilt-proof", w: 2, l: 0, by: "reports", matchId: "M1" },
        [pairKey("low-ground", "second-wind")]: { winner: "low-ground", w: 2, l: 1, by: "reports", matchId: "M3" },
      },
    },
    schedule: { ...schedule, waveDeadlines: [new Date(now.getTime() - 3 * 3_600_000).toISOString(), ...schedule.waveDeadlines.slice(1)] },
    subs: [],
    reports: [],
    disputes: [],
    extensions: [
      { id: "x1", matchId: "M4", teamId: "hot-coffee", requestedBy: "glint", hours: 1, reason: "Two of us get off work late. Backline Bandits agreed to start an hour later.", status: "pending", createdAt: new Date(now.getTime() - 3_600_000).toISOString() },
    ],
    payouts: [],
  };
}

function saturdaySixStack(): TournamentAgg {
  const names = ["Team Aurora", "Team Basalt", "Team Cinder", "Team Drift"];
  const handles = "zorra mirka luxen velis tavro neoka ashri rindo daxen yulo fenra oroth pipka solix zenra jaxo iralo bexen cyro kaito luma mira tovi nyla".split(" ");
  const teams: Record<string, Team> = {};
  const ranks = [14, 13, 14, 13];
  names.forEach((name, i) => {
    const id = name.toLowerCase().replace(/\s+/g, "-");
    teams[id] = makeTeam(id, name, GAMES.mr.roles, handles.slice(i * 6, i * 6 + 6), ranks[i], (j) => !(i === 1 && j === 4) && !(i === 3 && j === 2), "self");
  });
  return {
    id: "saturday-six-stack",
    version: 1,
    name: "Saturday Six-Stack Social",
    game: "mr",
    host: "kestrel",
    status: "checkin",
    region: "NA",
    signupType: "solo",
    allowExtensions: true,
    houseRules: ["Teams were built by the Scheme balancer; no roster trades after check-in."],
    entryFeeCents: 3000,
    withholdPct: 0,
    payoutSplit: [60, 30, 10],
    matchWindowHours: 24,
    state: { format: "single", bestOf: 3, slots: Object.keys(teams), teams, results: {} },
    schedule: { waveDeadlines: [], overrides: {} },
    subs: [
      { handle: "sablewing", score: 12, role: "Strategist", verified: "self", checkedIn: true },
      { handle: "quartzy", score: 15, role: "Duelist", verified: "self", checkedIn: true },
      { handle: "harlow", score: 13, role: "Strategist", verified: "self", checkedIn: true },
    ],
    reports: [],
    disputes: [],
    extensions: [],
    payouts: [],
  };
}

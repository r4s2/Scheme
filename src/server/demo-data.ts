import { GAMES, buildBracket, finalPlaces, makeSchedule, pairKey, playableMatches, recordResult, type FormatId, type GameId, type Player, type Team, type TournamentState } from "@/engine";
import type { Profile, Roster, TournamentAgg } from "./model";

/**
 * Sample data, mirroring the prototype. Demo mode loads it into memory, and
 * `npm run seed:generate` turns the same data into supabase/seed.sql, so the
 * database and demo mode always show the same things:
 *
 * - Friday Night Spike: live Valorant event with an overdue match, an
 *   extension request and open matches.
 * - Saturday Six-Stack Social: Marvel Rivals in check-in, two no-shows, subs
 *   waiting, $30 entry.
 * - Eight open events across all four games for the tournament library.
 * - Forty closed events whose winners fill the leaderboards.
 */
export function demoTournaments(now: Date): TournamentAgg[] {
  return [fridayNightSpike(now), saturdaySixStack(now), ...library(now), ...history(now)];
}

/** Host karma for everyone who hosts in the sample data. */
export const DEMO_HOST_KARMA: Record<string, number> = {
  kestrel: 92,
  mako_tv: 95,
  sundae_ow: 88,
  harbor_gg: 91,
  lumen_lol: 84,
  quill: 79,
  wren_plays: 97,
  staticc: 82,
  orbit_esports: 90,
};

// ---------------------------------------------------------------------------
// Helpers

const HOUR = 3_600_000;
const at = (now: Date, hours: number) => new Date(now.getTime() + hours * HOUR).toISOString();

/** A clock time in Eastern time, `days` calendar days from today: listings read "Sat, 8:00 PM ET". */
export function easternAt(now: Date, days: number, hour: number, minute = 0): string {
  const shown = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offset = now.getTime() - shown.getTime();
  const d = new Date(shown);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return new Date(d.getTime() + offset).toISOString();
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Small deterministic hash, so sample data is identical on every run. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Player karma between 72 and 99, stable per handle. */
export function demoKarma(handle: string): number {
  return 72 + (hash(handle) % 28);
}

const offsets = [2, 0, 1, -1, -2, 0];

function player(handle: string, role: string, score: number, verified: Player["verified"], checkedIn = true): Player {
  return { handle, score, role, verified, checkedIn, karma: demoKarma(handle) };
}

function makeTeam(name: string, game: GameId, handles: string[], rank: number, opts: { roles?: string[]; checkedIn?: (i: number) => boolean; verified?: Player["verified"] } = {}): Team {
  const roles = opts.roles ?? GAMES[game].roles;
  const verified = opts.verified ?? (game === "mr" ? "self" : "api");
  return {
    id: slug(name),
    name,
    captain: handles[0],
    players: roles.map((role, j) => player(handles[j], role, Math.max(0, rank + offsets[j % offsets.length]), verified, opts.checkedIn ? opts.checkedIn(j) : true)),
  };
}

function base(o: Partial<TournamentAgg> & Pick<TournamentAgg, "id" | "name" | "game" | "host" | "status" | "startsAt" | "teamCount" | "rankMin" | "rankMax"> & { format?: FormatId; bestOf?: 1 | 3 | 5; teams?: Team[] }): TournamentAgg {
  const teams = Object.fromEntries((o.teams ?? []).map((t) => [t.id, t]));
  const { format = "single", bestOf = 3, teams: _teams, ...rest } = o;
  void _teams;
  return {
    version: 1,
    region: "NA",
    signupType: "team",
    allowExtensions: true,
    houseRules: [],
    entryFeeCents: 0,
    withholdPct: 0,
    payoutSplit: [60, 30, 10],
    matchWindowHours: 24,
    state: { format, bestOf, slots: Object.keys(teams), teams, results: {} },
    schedule: { waveDeadlines: [], overrides: {} },
    roles: GAMES[o.game].roles,
    requirements: { minKarma: 0, verifiedOnly: o.game !== "mr" },
    balanceGoal: "even",
    checkinMinutes: 60,
    subs: [],
    pool: [],
    reports: [],
    disputes: [],
    extensions: [],
    payouts: [],
    announcements: [],
    tickets: [],
    ...rest,
  };
}

// Handles for generated players: two or three syllables plus a style. Every
// generated handle is unique across the whole sample, and each seed's handles
// are cached so repeated calls return the same people.
const SYL = "ka ri vo len mi za tor bex ul sa no fi ra jun dax ky ve lo mar tis qua pen ro ash el gri hal ny ob".split(" ");
const allocated = new Map<string, string[]>();
const taken = new Set<string>();
function handlesFor(seed: string, n: number): string[] {
  const key = `${seed}#${n}`;
  const cached = allocated.get(key);
  if (cached) return cached;
  const out: string[] = [];
  for (let i = 0; out.length < n; i++) {
    const h = hash(`${seed}:${i}`);
    const word = SYL[h % SYL.length] + SYL[(h >>> 5) % SYL.length] + (h % 3 === 0 ? SYL[(h >>> 10) % SYL.length] : "");
    const handle = (h % 5 === 0 ? `${word}_${h % 97}` : h % 7 === 0 ? `x${word}` : word).slice(0, 16);
    if (handle.length < 3 || taken.has(handle) || RESERVED.has(handle)) continue;
    taken.add(handle);
    out.push(handle);
  }
  allocated.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// Live and check-in events

const FNS_HANDLES = "ember vexa moth kiro tallulah vanta sundew ozzy pixelwitch b0lt harbor juno ketchup ruin nimbus pebble quokka dandelion fizz grit sable lumen cobra wren tofu quill staticc haze rook zephyr glint crumb delta iris koi lynx mint nox pyre orbitz".split(" ");
const VAL_TEAMS: [string, number][] = [
  ["Tilt Proof", 19], ["Eco Round", 11], ["Night Shift", 16], ["Paper Tigers", 13],
  ["Low Ground", 18], ["Second Wind", 14], ["Hot Coffee", 17], ["Backline Bandits", 15],
];

function valRoster(name: string): string[] {
  const i = VAL_TEAMS.findIndex(([n]) => n === name);
  const hs = FNS_HANDLES.slice(i * 5, i * 5 + 5);
  // Hot Coffee's captain is glint, matching the prototype's player view.
  if (name === "Hot Coffee") hs.unshift(hs.splice(hs.indexOf("glint"), 1)[0]);
  return hs;
}

function fridayNightSpike(now: Date): TournamentAgg {
  const teams = VAL_TEAMS.map(([name, rank]) => makeTeam(name, "val", valRoster(name), rank));
  const started = at(now, -27);
  const schedule = makeSchedule(started, 24, 3);
  // M2 is three hours overdue; M4 has a few hours left.
  schedule.waveDeadlines[0] = at(now, -3);
  schedule.overrides = { M4: at(now, 3) };
  const t = base({
    id: "friday-night-spike",
    name: "Friday Night Spike",
    game: "val",
    host: "kestrel",
    status: "live",
    region: "NA East",
    startsAt: started,
    teamCount: 8,
    rankMin: 9,
    rankMax: 21,
    houseRules: ["Overtime: win by two, no cap.", "Screenshot the final scoreboard of every map."],
    teams,
    schedule,
  });
  t.state.results = {
    [pairKey("tilt-proof", "eco-round")]: { winner: "tilt-proof", w: 2, l: 0, by: "reports", matchId: "M1" },
    [pairKey("low-ground", "second-wind")]: { winner: "low-ground", w: 2, l: 1, by: "reports", matchId: "M3" },
  };
  t.extensions = [
    { id: "x1", matchId: "M4", teamId: "hot-coffee", requestedBy: "glint", hours: 1, reason: "Two of us get off work late. Backline Bandits agreed to start an hour later.", status: "pending", createdAt: at(now, -1) },
  ];
  t.announcements = [
    { id: "a1", audience: "all", body: "Welcome to Friday Night Spike! Lobby details are on your match page. Captains: screenshot the final scoreboard of every map.", sentBy: "kestrel", createdAt: at(now, -26) },
    { id: "a2", audience: "all", body: "Round 1 closes in a few hours. If you can't play before the deadline, request an extension from your match page.", sentBy: "kestrel", createdAt: at(now, -6) },
  ];
  t.tickets = [
    {
      id: "k1",
      openedBy: "lynx",
      teamId: "backline-bandits",
      matchId: "M4",
      category: "schedule",
      subject: "Can M4 start an hour later?",
      status: "open",
      createdAt: at(now, -2),
      messages: [{ id: "k1m1", author: "lynx", body: "Hot Coffee asked to push M4 by an hour and we're fine with it. Just checking that's OK with you.", createdAt: at(now, -2) }],
    },
  ];
  return t;
}

function saturdaySixStack(now: Date): TournamentAgg {
  const names = ["Team Aurora", "Team Basalt", "Team Cinder", "Team Drift"];
  const handles = "zorra mirka luxen velis tavro neoka ashri rindo daxen yulo fenra oroth pipka solix zenra jaxo iralo bexen cyro kaito luma mira tovi nyla".split(" ");
  const ranks = [14, 13, 14, 13];
  const teams = names.map((name, i) =>
    makeTeam(name, "mr", handles.slice(i * 6, i * 6 + 6), ranks[i], { checkedIn: (j) => !(i === 1 && j === 4) && !(i === 3 && j === 2) }),
  );
  const t = base({
    id: "saturday-six-stack",
    name: "Saturday Six-Stack Social",
    game: "mr",
    host: "kestrel",
    status: "checkin",
    startsAt: at(now, 1),
    teamCount: 4,
    rankMin: 9,
    rankMax: 18,
    signupType: "solo",
    entryFeeCents: 3000,
    houseRules: ["Teams were built by the Scheme balancer; no roster trades after check-in."],
    teams,
  });
  t.subs = [player("sablewing", "Strategist", 12, "self"), player("quartzy", "Duelist", 15, "self"), player("harlow", "Strategist", 13, "self")];
  return t;
}

// ---------------------------------------------------------------------------
// Tournament library: events taking sign-ups

interface Listing {
  name: string;
  game: GameId;
  format: FormatId;
  signup: "team" | "solo";
  feeCents: number;
  teamCount: number;
  registered: number;
  /** Calendar days from today and Eastern clock time. */
  starts: [days: number, hour: number, minute?: number];
  host: string;
  rankMin: number;
  rankMax: number;
  region: string;
}

const LIBRARY: Listing[] = [
  { name: "Ascendant Ladder Night", game: "val", format: "double", signup: "team", feeCents: 0, teamCount: 16, registered: 11, starts: [3, 20], host: "mako_tv", rankMin: 15, rankMax: 23, region: "NA East" },
  { name: "Tank Diff Tuesday", game: "ow", format: "single", signup: "solo", feeCents: 0, teamCount: 8, registered: 31, starts: [4, 19, 30], host: "sundae_ow", rankMin: 15, rankMax: 29, region: "NA" },
  { name: "Dive Comp Showdown", game: "mr", format: "groups", signup: "team", feeCents: 3000, teamCount: 8, registered: 6, starts: [2, 18], host: "harbor_gg", rankMin: 11, rankMax: 20, region: "NA" },
  { name: "Rift Rookies Open", game: "lol", format: "swiss", signup: "solo", feeCents: 0, teamCount: 16, registered: 54, starts: [8, 19], host: "lumen_lol", rankMin: 0, rankMax: 15, region: "NA" },
  { name: "Payload Pals Scrim Night", game: "ow", format: "rr", signup: "team", feeCents: 1000, teamCount: 4, registered: 3, starts: [1, 22], host: "quill", rankMin: 10, rankMax: 24, region: "NA" },
  { name: "Strategist Social", game: "mr", format: "single", signup: "solo", feeCents: 0, teamCount: 8, registered: 39, starts: [0, 23], host: "wren_plays", rankMin: 6, rankMax: 18, region: "NA" },
  { name: "Midnight Spike Rush", game: "val", format: "single", signup: "solo", feeCents: 0, teamCount: 8, registered: 22, starts: [0, 21], host: "staticc", rankMin: 6, rankMax: 14, region: "NA West" },
  { name: "Flex Queue Refugees", game: "lol", format: "double", signup: "team", feeCents: 2500, teamCount: 16, registered: 12, starts: [9, 20], host: "orbit_esports", rankMin: 12, rankMax: 27, region: "NA" },
];

const TEAM_NAMES = "Ultra Instinct,Pocket Healers,Sixth Sense,Wall Hackers,Clutch Factory,Rotate Left,Late Rotation,Full Send,Spawn Campers,Mid Diff,Smoke Screen,Peak Performance,Neon Tide,Snack Break,Ranked Anxiety,Quiet Storm".split(",");

function library(now: Date): TournamentAgg[] {
  return LIBRARY.map((l) => {
    const id = slug(l.name);
    const span = l.rankMax - l.rankMin;
    const t = base({
      id,
      name: l.name,
      game: l.game,
      host: l.host,
      status: "registration",
      region: l.region,
      startsAt: easternAt(now, ...l.starts),
      teamCount: l.teamCount,
      rankMin: l.rankMin,
      rankMax: l.rankMax,
      signupType: l.signup,
      entryFeeCents: l.feeCents,
      format: l.format,
    });
    const size = GAMES[l.game].roles.length;
    if (l.signup === "team") {
      const hs = handlesFor(id, l.registered * size);
      const teams = Array.from({ length: l.registered }, (_, i) => {
        const rank = l.rankMin + 1 + (hash(`${id}:${i}`) % Math.max(1, span - 2));
        return makeTeam(TEAM_NAMES[i % TEAM_NAMES.length], l.game, hs.slice(i * size, i * size + size), rank, { checkedIn: () => false });
      });
      t.state.teams = Object.fromEntries(teams.map((x) => [x.id, x]));
      t.state.slots = teams.map((x) => x.id);
    } else {
      const roles = GAMES[l.game].roles;
      t.pool = handlesFor(id, l.registered).map((h, i) => player(h, roles[i % roles.length], l.rankMin + (hash(h) % (span + 1)), l.game === "mr" ? "self" : "api"));
    }
    return t;
  });
}

// ---------------------------------------------------------------------------
// Closed events: their winners make up the leaderboards

const MR_TEAMS = ["Dive Comp Dads", "Orbital Strike", "Team Gale", "Strat Pack", "Low Orbit", "Fault Line", "Side Quest", "Ult Economy"];
const OW_TEAMS = ["Shield Bash", "Payload Pushers", "Grav Drop", "Tank Diff", "Point Holders", "Overtime Heroes", "High Ground", "Cooldown Club"];
const ROSTER_RANK: Record<GameId, number> = { val: 15, mr: 13, ow: 17, lol: 14 };

/** Who won how many, per game. Totals: 17 Valorant, 12 Marvel Rivals, 10 Overwatch. */
const HISTORY: Record<GameId, [string, number][]> = {
  val: [["Tilt Proof", 6], ["Low Ground", 4], ["Hot Coffee", 3], ["Night Shift", 2], ["Second Wind", 1], ["Backline Bandits", 1]],
  mr: [["Dive Comp Dads", 5], ["Orbital Strike", 3], ["Team Gale", 2], ["Low Orbit", 1], ["Strat Pack", 1]],
  ow: [["Shield Bash", 4], ["Payload Pushers", 2], ["Grav Drop", 2], ["Tank Diff", 1], ["Point Holders", 1]],
  lol: [],
};

const EVENT_NAMES: Record<GameId, string[]> = {
  val: ["Plant & Pray Cup", "Spike Rush Social", "Ascendant Open", "Retake Royale", "Eco Round Invitational", "Clutch or Kick", "Sunday Night Spike"],
  mr: ["Team-Up Tuesday", "Dive Night", "Strategist Cup", "Six-Stack Saturday", "Ult Economy Open"],
  ow: ["Push Night", "Payload Social", "Control Point Cup", "Overtime Open", "Hybrid Hustle"],
  lol: [],
};

const HOSTS: Record<GameId, string[]> = { val: ["kestrel", "mako_tv", "staticc"], mr: ["harbor_gg", "wren_plays", "kestrel"], ow: ["sundae_ow", "quill"], lol: ["lumen_lol"] };

function rosterFor(game: GameId, name: string): string[] {
  if (game === "val" && VAL_TEAMS.some(([n]) => n === name)) return valRoster(name);
  return handlesFor(`${game}:${name}`, GAMES[game].roles.length);
}

/** Play a bracket out with deterministic scores; `champion` wins every match it plays. */
function playOut(state: TournamentState, champion: string, seed: string): TournamentState {
  let s = state;
  for (let guard = 0; guard < 64; guard++) {
    const open = playableMatches(s, buildBracket(s));
    if (open.length === 0) break;
    for (const m of open) {
      const h = hash(`${seed}:${m.id}`);
      const winner = m.a === champion ? m.a! : m.b === champion ? m.b! : h % 2 ? m.a! : m.b!;
      s = recordResult(s, m.id, winner, 2, h % 3 === 0 ? 1 : 0, "reports").state;
    }
  }
  return s;
}

function history(now: Date): TournamentAgg[] {
  const out: TournamentAgg[] = [];
  let n = 0;
  for (const game of ["val", "mr", "ow"] as GameId[]) {
    const pool = game === "val" ? VAL_TEAMS.map(([name]) => name) : game === "mr" ? MR_TEAMS : OW_TEAMS;
    let k = 0;
    for (const [winner, count] of HISTORY[game]) {
      for (let i = 0; i < count; i++, k++, n++) {
        const thursday = game === "mr" && winner === "Strat Pack";
        const others = pool.filter((x) => x !== winner);
        const rotate = (hash(`${game}:${k}`) % others.length);
        const size = thursday ? 8 : 4;
        const names = [winner, ...[...others.slice(rotate), ...others.slice(0, rotate)].slice(0, size - 1)];
        const teams = names.map((name) => makeTeam(name, game, rosterFor(game, name), ROSTER_RANK[game] + (hash(name) % 5) - 2));
        const name = thursday ? "Thursday Throwdown" : `${EVENT_NAMES[game][k % EVENT_NAMES[game].length]} #${Math.floor(k / EVENT_NAMES[game].length) + 1}`;
        const id = thursday ? "thursday-throwdown" : `${game}-${slug(name)}`;
        // Spread over the last ten weeks, newest first; Thursday Throwdown closed yesterday.
        const startedH = thursday ? -28 : -(48 + ((n * 41) % 1650));
        const t = base({
          id,
          name,
          game,
          host: thursday ? "harbor_gg" : HOSTS[game][k % HOSTS[game].length],
          status: "complete",
          startsAt: at(now, startedH),
          teamCount: size,
          rankMin: ROSTER_RANK[game] - 6,
          rankMax: ROSTER_RANK[game] + 6,
          entryFeeCents: thursday ? 3000 : 0,
          teams,
        });
        // Shuffle seeding so the champion isn't always the top slot.
        const slots = [...t.state.slots];
        const r = hash(id) % slots.length;
        t.state.slots = [...slots.slice(r), ...slots.slice(0, r)];
        t.state = playOut(t.state, slug(winner), id);
        t.schedule = makeSchedule(t.startsAt, 24, Math.log2(size));
        const places = finalPlaces(buildBracket(t.state), { method: "bracket" });
        t.closure = { at: at(now, startedH + 26), method: places.method, places: places.places, message: `GG to everyone who played. ${winner} take it!` };
        out.push(t);
      }
    }
  }
  return out;
}

/** Handles used by named sample players; generated handles avoid them. */
const RESERVED = new Set([
  ...FNS_HANDLES,
  ...Object.keys(DEMO_HOST_KARMA),
  ..."zorra mirka luxen velis tavro neoka ashri rindo daxen yulo fenra oroth pipka solix zenra jaxo iralo bexen cyro kaito luma mira tovi nyla sablewing quartzy harlow".split(" "),
]);

// ---------------------------------------------------------------------------
// Profiles and saved teams

const NAME_SUFFIX: Record<GameId, (h: string) => string> = {
  val: (h) => `${h}#NA1`,
  lol: (h) => `${h}#NA1`,
  ow: (h) => `${h[0].toUpperCase()}${h.slice(1)}#${1000 + (hash(h) % 9000)}`,
  mr: (h) => `UID ${100000000 + (hash(h) % 900000000)}`,
};

/** Kestrel hosts most samples but plays too: an account in every game. */
const KESTREL_ACCOUNTS: [GameId, number][] = [["val", 18], ["mr", 14], ["ow", 17], ["lol", 15]];

/**
 * Everyone in the sample data, with a linked account (and verified rank) for
 * each game they play. A player's rank is taken from their most current
 * event: open and live events first, then the newest closed one.
 */
export function demoProfiles(all: TournamentAgg[]): Profile[] {
  const byCurrency = [...all].sort((a, b) => rankOrder(a) - rankOrder(b) || b.startsAt.localeCompare(a.startsAt));
  const profiles = new Map<string, Profile>();
  const get = (h: string) => {
    let p = profiles.get(h);
    if (!p) profiles.set(h, (p = { handle: h, playerKarma: demoKarma(h), hostKarma: DEMO_HOST_KARMA[h] ?? 70, accounts: [] }));
    return p;
  };
  for (const t of byCurrency) {
    get(t.host);
    const people = [...Object.values(t.state.teams).flatMap((x) => x.players), ...t.subs, ...t.pool];
    for (const pl of people) {
      const p = get(pl.handle);
      if (!p.accounts.some((a) => a.game === t.game)) p.accounts.push({ game: t.game, accountName: NAME_SUFFIX[t.game](pl.handle), rankScore: pl.score, source: pl.verified, roles: [pl.role] });
    }
  }
  const k = get("kestrel");
  for (const [game, score] of KESTREL_ACCOUNTS) {
    if (!k.accounts.some((a) => a.game === game)) k.accounts.push({ game, accountName: NAME_SUFFIX[game]("kestrel"), rankScore: score, source: game === "mr" ? "self" : "api", roles: [GAMES[game].roles[0]] });
  }
  // Same order as the database's game_id enum.
  const order = Object.keys(GAMES);
  for (const p of profiles.values()) p.accounts.sort((a, b) => order.indexOf(a.game) - order.indexOf(b.game));
  return [...profiles.values()].sort((a, b) => a.handle.localeCompare(b.handle));
}

function rankOrder(t: TournamentAgg) {
  return t.status === "complete" || t.status === "cancelled" ? 1 : 0;
}

/** Saved teams: every team that plays in the sample history, with its regular roster. */
export function demoRosters(): Roster[] {
  // Generated handles are handed out in a fixed order the first time the sample is built.
  demoTournaments(new Date(0));
  const out: Roster[] = [];
  const add = (game: GameId, name: string, handles: string[]) =>
    out.push({ id: `${game}-${slug(name)}`, name, game, captain: handles[0], members: handles.map((h, i) => ({ handle: h, role: GAMES[game].roles[i] ?? null, status: "active" })) });
  for (const [name] of VAL_TEAMS) add("val", name, valRoster(name));
  for (const name of MR_TEAMS) add("mr", name, rosterFor("mr", name));
  for (const name of OW_TEAMS) add("ow", name, rosterFor("ow", name));
  return out;
}

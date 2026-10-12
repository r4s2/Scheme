import { balanceTeams, GAMES, rankName, roleCounts, seedSlots, type Player, type Team } from "@/engine";
import { OperationError, type Ctx, type Effects, type Outcome, type Profile, type TournamentAgg } from "./model";
import { audit, begin, done, notify, requireHost } from "./operations";

/**
 * Registration: captains register teams, players join solo, and the host
 * turns solo sign-ups into balanced teams. Every check uses the player's
 * linked game account, so ranks and karma come from Scheme, not the form.
 */

const SOLO_TEAM_NAMES = "Aurora Basalt Cinder Drift Echo Flint Gale Harbor Indigo Juniper Kestrel Lumen Mistral Nova Onyx Pike Quartz Ridge Sable Talon Umber Vortex Willow Xenon Yarrow Zephyr Ash Birch Comet Delta Ember Frost".split(" ");

const lower = (h: string) => h.toLowerCase();

/** Starters and substitutes on a team. */
export const fullRoster = (t: Team): Player[] => [...t.players, ...(t.bench ?? [])];

/** Everyone already in the tournament: on a team (starting or as a sub), waiting as a free-agent sub, or signed up solo. */
function entrants(agg: TournamentAgg, exceptTeam?: string): Set<string> {
  return new Set([
    ...Object.values(agg.state.teams)
      .filter((t) => t.id !== exceptTeam)
      .flatMap((t) => fullRoster(t).map((p) => lower(p.handle))),
    ...agg.subs.map((p) => lower(p.handle)),
    ...agg.pool.map((p) => lower(p.handle)),
  ]);
}

/** Seats in a full event: teams for team sign-up, players for solo. */
export function capacity(agg: TournamentAgg): number {
  return agg.signupType === "solo" ? agg.teamCount * agg.roles.length : agg.teamCount;
}

export function registeredCount(agg: TournamentAgg): number {
  const teams = Object.values(agg.state.teams);
  return agg.signupType === "solo" ? teams.reduce((n, t) => n + t.players.length, 0) + agg.pool.length : teams.length;
}

/** "Gold 1 to Diamond 3", or null when the event has no rank range. */
export function rangeText(agg: Pick<TournamentAgg, "game" | "rankMin" | "rankMax" | "rankRule">): string | null {
  return agg.rankRule === "open" ? null : `${rankName(agg.game, agg.rankMin)} to ${rankName(agg.game, agg.rankMax)}`;
}

/**
 * Why a player can't enter this event, or null if they can. Checks their
 * linked account for the game, rank range (when the host requires it),
 * verification and karma.
 */
export type EligibilityRules = Pick<TournamentAgg, "game" | "rankRule" | "rankMin" | "rankMax" | "requirements">;

export function ineligibility(agg: EligibilityRules, profile: Profile | undefined, handle: string): string | null {
  if (!profile) return `${handle} doesn't have a Scheme profile.`;
  const game = GAMES[agg.game];
  const acct = profile.accounts.find((a) => a.game === agg.game);
  if (!acct) return `${profile.handle} hasn't linked a ${game.name} account.`;
  if (agg.rankRule === "required" && (acct.rankScore < agg.rankMin || acct.rankScore > agg.rankMax)) {
    return `${profile.handle} is ${rankName(agg.game, acct.rankScore)}; this event is for ${rangeText(agg)}.`;
  }
  // Marvel Rivals ranks are self-reported until a data provider is signed, so verification can't be required there yet.
  if (agg.requirements.verifiedOnly && acct.source !== "api" && agg.game !== "mr") return `${profile.handle}'s ${game.name} rank isn't verified yet.`;
  if (profile.playerKarma < agg.requirements.minKarma) return `${profile.handle}'s karma is ${profile.playerKarma}; this event needs ${agg.requirements.minKarma}.`;
  return null;
}

/** For a suggested range: a heads-up when a player is outside it. They can still sign up. */
export function rankNote(agg: EligibilityRules, profile: Profile | undefined): string | null {
  if (agg.rankRule !== "suggested" || !profile) return null;
  const acct = profile.accounts.find((a) => a.game === agg.game);
  if (!acct || (acct.rankScore >= agg.rankMin && acct.rankScore <= agg.rankMax)) return null;
  return `Outside the suggested ${rangeText(agg)}`;
}

function requireRegistration(agg: TournamentAgg, signup: "team" | "solo") {
  if (agg.status !== "registration") throw new OperationError("Registration is closed for this event.", "conflict");
  if (agg.signupType !== signup) {
    throw new OperationError(signup === "team" ? "This is a solo sign-up event: join on your own and Scheme builds the teams." : "This event takes whole teams. Ask a captain to register you.", "conflict");
  }
}

function asPlayer(profile: Profile, game: TournamentAgg["game"], role: string): Player {
  const acct = profile.accounts.find((a) => a.game === game)!;
  return { handle: profile.handle, score: acct.rankScore, role, verified: acct.source, checkedIn: false, karma: profile.playerKarma };
}

export interface RosterSpot {
  handle: string;
  role: string;
}

export interface TeamEntry {
  name: string;
  /** Starters, one per seat in the event's lineup. */
  players: RosterSpot[];
  /** Substitutes on top of the starters, up to the event's limit. */
  bench?: RosterSpot[];
}

/**
 * Every check a roster has to pass, for registering a team or editing one:
 * name, a full starting lineup with the right roles, subs within the limit,
 * no one listed twice or already in the event, and every player eligible.
 */
function checkRoster(agg: TournamentAgg, actor: string, entry: TeamEntry, profiles: Profile[], teamId?: string) {
  const G = GAMES[agg.game];
  const teams = Object.values(agg.state.teams).filter((t) => t.id !== teamId);
  const name = entry.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 40) throw new OperationError("Team names are 2 to 40 characters.");
  if (teams.some((t) => lower(t.name) === lower(name))) throw new OperationError(`A team called ${name} is already registered.`, "conflict");

  const seats = entry.players.map((p) => ({ handle: p.handle.trim(), role: p.role }));
  const bench = (entry.bench ?? []).map((p) => ({ handle: p.handle.trim(), role: p.role }));
  if (seats.length !== agg.roles.length) throw new OperationError(`Teams in this event start ${agg.roles.length} players.`);
  if (seats.some((p) => !p.handle)) throw new OperationError("Fill every starting spot on the team.");
  if (bench.length > agg.benchMax) throw new OperationError(agg.benchMax ? `Teams in this event can list up to ${agg.benchMax} sub${agg.benchMax === 1 ? "" : "s"}.` : "This event doesn't take subs.");
  if (bench.some((p) => !p.handle)) throw new OperationError("Fill in or remove each empty sub slot.");
  const all = [...seats, ...bench];
  if (new Set(all.map((p) => lower(p.handle))).size !== all.length) throw new OperationError("The same player is listed twice.");
  if (!seats.some((p) => lower(p.handle) === lower(actor))) throw new OperationError("Captains play on the team they register. Add yourself to the starting lineup.");

  if (G.lockedRoles) {
    const need = roleCounts(agg.roles);
    const have = roleCounts(seats.map((p) => p.role));
    for (const role of new Set([...Object.keys(need), ...Object.keys(have)])) {
      if ((need[role] ?? 0) !== (have[role] ?? 0)) {
        throw new OperationError(`This event's starting lineups are ${Object.entries(need).map(([r, n]) => `${n} ${r}`).join(", ")}. Check the roles.`);
      }
    }
  } else if (seats.some((p) => !G.roleOptions.includes(p.role))) {
    throw new OperationError(`Pick a role for every starter: ${G.roleOptions.join(", ")}.`);
  }
  if (bench.some((p) => !G.roleOptions.includes(p.role))) throw new OperationError(`Pick a role for every sub: ${G.roleOptions.join(", ")}.`);

  const taken = entrants(agg, teamId);
  const byHandle = new Map(profiles.map((p) => [lower(p.handle), p]));
  for (const s of all) {
    if (taken.has(lower(s.handle))) throw new OperationError(`${s.handle} is already in this event.`, "conflict");
    const why = ineligibility(agg, byHandle.get(lower(s.handle)), s.handle);
    if (why) throw new OperationError(why, "conflict");
  }
  const profileOf = (h: string) => byHandle.get(lower(h))!;
  return { name, seats, bench, profileOf };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * A captain registers a team: the starting lineup plus any subs. Everyone
 * the captain listed gets a notification to confirm they're playing.
 */
export function registerTeam(agg: TournamentAgg, ctx: Ctx, entry: TeamEntry, profiles: Profile[]): Outcome {
  requireRegistration(agg, "team");
  const teams = Object.values(agg.state.teams);
  if (teams.length >= agg.teamCount) throw new OperationError("This event is full.", "conflict");
  const { name, seats, bench, profileOf } = checkRoster(agg, ctx.actor, entry, profiles);

  const { next, effects } = begin(agg);
  const captain = profileOf(ctx.actor).handle;
  const make = (s: RosterSpot): Player => {
    const p = asPlayer(profileOf(s.handle), agg.game, s.role);
    return p.handle === captain ? p : { ...p, confirmation: "pending" };
  };
  const team: Team = { id: ctx.newId(), name, captain, players: seats.map(make), bench: bench.map(make) };
  next.state = { ...agg.state, teams: { ...agg.state.teams, [team.id]: team }, slots: [...agg.state.slots, team.id] };
  const left = agg.teamCount - teams.length - 1;
  audit(effects, ctx, "registration.team", `Registered ${name}${team.bench!.length ? ` with ${plural(team.bench!.length, "sub")}` : ""}.`);
  askToConfirm(effects, next, captain, name, team.players, team.bench!);
  notify(effects, next, [agg.host], "registration", `${name} registered for ${agg.name} (${teams.length + 1} of ${agg.teamCount} teams).`);
  const asked = fullRoster(team).filter((p) => p.confirmation).length;
  return done(
    next,
    effects,
    `${name} is registered. ${left ? `${left} spot${left === 1 ? "" : "s"} left.` : "The event is full."}${asked ? ` ${plural(asked, "teammate")} will get a notification to confirm.` : ""}`,
  );
}

function askToConfirm(effects: Effects, agg: TournamentAgg, captain: string, team: string, starters: Player[], bench: Player[]) {
  const ask = (ps: Player[], as: string) =>
    notify(effects, agg, ps.filter((p) => p.confirmation === "pending").map((p) => p.handle), "roster_confirm", `${captain} added you to ${team} for ${agg.name} ${as}. Confirm you're playing.`);
  ask(starters, "as a starter");
  ask(bench, "as a sub");
}

/**
 * The captain changes their registered roster while registration is open:
 * swap players, change roles, add or remove subs, or rename the team.
 * Players who stay keep their confirmation; new players are asked to confirm.
 */
export function updateRoster(agg: TournamentAgg, ctx: Ctx, teamId: string, entry: TeamEntry, profiles: Profile[]): Outcome {
  requireRegistration(agg, "team");
  const team = agg.state.teams[teamId];
  if (!team) throw new OperationError("That team isn't registered.", "not_found");
  if (team.captain !== ctx.actor) throw new OperationError("Only the captain can change the roster.", "forbidden");
  const { name, seats, bench, profileOf } = checkRoster(agg, ctx.actor, entry, profiles, teamId);

  const before = new Map(fullRoster(team).map((p) => [lower(p.handle), p]));
  const make = (s: RosterSpot): Player => {
    const p = asPlayer(profileOf(s.handle), agg.game, s.role);
    const old = before.get(lower(s.handle));
    if (p.handle === team.captain) return p;
    return old ? (old.confirmation ? { ...p, confirmation: old.confirmation } : p) : { ...p, confirmation: "pending" };
  };
  const updated: Team = { ...team, name, players: seats.map(make), bench: bench.map(make) };
  const nowOn = new Set(fullRoster(updated).map((p) => lower(p.handle)));
  const removed = fullRoster(team).filter((p) => !nowOn.has(lower(p.handle)));
  const added = fullRoster(updated).filter((p) => !before.has(lower(p.handle)));

  const { next, effects } = begin(agg);
  next.state = { ...agg.state, teams: { ...agg.state.teams, [teamId]: updated } };
  const changes = [
    name !== team.name ? `renamed to ${name}` : "",
    added.length ? `added ${added.map((p) => p.handle).join(", ")}` : "",
    removed.length ? `removed ${removed.map((p) => p.handle).join(", ")}` : "",
  ].filter(Boolean);
  audit(effects, ctx, "registration.roster", `${team.name}: ${changes.join("; ") || "changed roles"}.`);
  const isNew = new Set(added.map((p) => lower(p.handle)));
  askToConfirm(effects, next, team.captain, name, updated.players.filter((p) => isNew.has(lower(p.handle))), updated.bench!.filter((p) => isNew.has(lower(p.handle))));
  notify(effects, next, removed.map((p) => p.handle), "registration", `${team.captain} took you off ${team.name}'s roster for ${agg.name}.`);
  return done(next, effects, `Roster saved.${added.length ? ` ${plural(added.length, "new player")} will get a notification to confirm.` : ""}`);
}

/** A player listed on a team answers the captain: playing, or can't make it. */
export function respondToRoster(agg: TournamentAgg, ctx: Ctx, accept: boolean): Outcome {
  if (agg.status !== "registration" && agg.status !== "checkin") throw new OperationError("This event has already started.", "conflict");
  const me = lower(ctx.actor);
  const team = Object.values(agg.state.teams).find((t) => fullRoster(t).some((p) => lower(p.handle) === me));
  const spot = team && fullRoster(team).find((p) => lower(p.handle) === me);
  if (!team || !spot) throw new OperationError("You aren't on a team in this event.", "not_found");
  if (!spot.confirmation) throw new OperationError(`You've already confirmed for ${team.name}.`, "conflict");
  if (!accept && spot.confirmation === "declined") throw new OperationError("You've already said you can't play.", "conflict");

  const { next, effects } = begin(agg);
  const answer = (p: Player): Player => {
    if (lower(p.handle) !== me) return p;
    if (accept) {
      const { confirmation: _, ...rest } = p;
      void _;
      return rest;
    }
    return { ...p, confirmation: "declined" };
  };
  next.state = { ...agg.state, teams: { ...agg.state.teams, [team.id]: { ...team, players: team.players.map(answer), bench: team.bench?.map(answer) } } };
  audit(effects, ctx, accept ? "registration.confirm" : "registration.decline", `${spot.handle} ${accept ? "confirmed for" : "can't play for"} ${team.name}.`);
  notify(
    effects,
    next,
    [team.captain],
    "registration",
    accept ? `${spot.handle} confirmed they're playing for ${team.name} in ${agg.name}.` : `${spot.handle} can't play for ${team.name} in ${agg.name}. Edit your roster to replace them.`,
  );
  return done(next, effects, accept ? `You're confirmed for ${team.name}.` : `Got it. ${team.captain} has been told you can't play.`);
}

/** A captain withdraws their team, or the host removes one, while registration is open. */
export function withdrawTeam(agg: TournamentAgg, ctx: Ctx, teamId: string): Outcome {
  if (agg.status !== "registration") throw new OperationError("Teams can only withdraw while registration is open.", "conflict");
  const team = agg.state.teams[teamId];
  if (!team) throw new OperationError("That team isn't registered.", "not_found");
  const isHost = ctx.actor === agg.host;
  if (!isHost && team.captain !== ctx.actor) throw new OperationError("Only the captain or the host can withdraw a team.", "forbidden");
  const { next, effects } = begin(agg);
  const teams = { ...agg.state.teams };
  delete teams[teamId];
  next.state = { ...agg.state, teams, slots: agg.state.slots.filter((s) => s !== teamId) };
  audit(effects, ctx, "registration.withdraw", `${isHost ? "Removed" : "Withdrew"} ${team.name}.`);
  notify(effects, next, fullRoster(team).map((p) => p.handle).filter((h) => h !== ctx.actor), "registration", `${team.name} ${isHost ? "was removed from" : "withdrew from"} ${agg.name}.`);
  return done(next, effects, `${team.name} ${isHost ? "was removed" : "withdrew"}.`);
}

/** A player signs up alone for a solo event, picking the role they want to play. */
export function joinSolo(agg: TournamentAgg, ctx: Ctx, role: string, profile: Profile | undefined): Outcome {
  requireRegistration(agg, "solo");
  if (!agg.roles.includes(role)) throw new OperationError(`Pick one of this event's roles: ${[...new Set(agg.roles)].join(", ")}.`);
  if (entrants(agg).has(lower(ctx.actor))) throw new OperationError("You're already signed up.", "conflict");
  if (registeredCount(agg) >= capacity(agg)) throw new OperationError("This event is full.", "conflict");
  const why = ineligibility(agg, profile, ctx.actor);
  if (why) throw new OperationError(why, "conflict");
  const { next, effects } = begin(agg);
  next.pool = [...agg.pool, asPlayer(profile!, agg.game, role)];
  audit(effects, ctx, "registration.solo", `${profile!.handle} signed up solo as ${role}.`);
  const left = capacity(agg) - registeredCount(next);
  return done(next, effects, `You're signed up as ${role}. Scheme builds the teams when registration closes.${left ? "" : " The event is now full."}`);
}

export function leaveSolo(agg: TournamentAgg, ctx: Ctx): Outcome {
  if (agg.status !== "registration") throw new OperationError("Sign-ups can only be withdrawn while registration is open.", "conflict");
  if (!agg.pool.some((p) => lower(p.handle) === lower(ctx.actor))) throw new OperationError("You aren't signed up.", "not_found");
  const { next, effects } = begin(agg);
  next.pool = agg.pool.filter((p) => lower(p.handle) !== lower(ctx.actor));
  audit(effects, ctx, "registration.leave", `${ctx.actor} withdrew their solo sign-up.`);
  return done(next, effects, "You've withdrawn. You can sign up again while registration is open.");
}

/**
 * The host turns solo sign-ups into teams with the balancer: even teams (or
 * rank tiers), every role filled, extra players kept as subs. Teams are then
 * seeded by rank so check-in can open.
 */
export function buildSoloTeams(agg: TournamentAgg, ctx: Ctx): Outcome {
  requireHost(agg, ctx);
  requireRegistration(agg, "solo");
  if (Object.keys(agg.state.teams).length) throw new OperationError("Teams are already built.", "conflict");
  const need = capacity(agg);
  if (agg.pool.length < need) throw new OperationError(`Building ${agg.teamCount} teams needs ${need} players; ${agg.pool.length} have signed up.`, "conflict");
  const result = balanceTeams(agg.pool, agg.teamCount, agg.roles, agg.balanceGoal);
  if (result.shortRoles.length) {
    throw new OperationError(`Not enough players for every seat: ${result.shortRoles.map((r) => `${r.role} ${r.have} of ${r.needed}`).join(", ")}. Wait for more sign-ups, or ask players to switch roles.`, "conflict");
  }
  const { next, effects } = begin(agg);
  const teams: Record<string, Team> = {};
  result.teams.forEach((t, i) => {
    const id = ctx.newId();
    const captain = [...t.players].sort((a, b) => (b.karma ?? 0) - (a.karma ?? 0) || a.handle.localeCompare(b.handle))[0].handle;
    teams[id] = { id, name: `Team ${SOLO_TEAM_NAMES[i % SOLO_TEAM_NAMES.length]}`, captain, players: t.players };
  });
  const state = { ...agg.state, teams, slots: Object.keys(teams) };
  next.state = { ...state, slots: seedSlots(state, state.slots, state.format) };
  next.pool = [];
  next.subs = [...agg.subs, ...result.unplaced];
  audit(effects, ctx, "registration.balance", `Built ${agg.teamCount} ${agg.balanceGoal === "tiers" ? "rank-tier" : "even"} teams from ${agg.pool.length} sign-ups.`);
  for (const t of Object.values(teams)) {
    notify(effects, next, t.players.map((p) => p.handle), "registration", `You're on ${t.name} for ${agg.name}${t.captain ? `, captained by ${t.captain}` : ""}.`);
  }
  notify(effects, next, result.unplaced.map((p) => p.handle), "registration", `${agg.name} filled every seat, so you're a sub: you'll be called in if someone doesn't check in.`);
  return done(
    next,
    effects,
    `Built ${agg.teamCount} teams. The strongest and weakest are ${result.spread.toFixed(1)} rank steps apart.${result.unplaced.length ? ` ${result.unplaced.length} extra player${result.unplaced.length === 1 ? " is a sub" : "s are subs"}.` : ""}`,
  );
}

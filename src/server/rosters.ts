import { GAMES, type GameId } from "@/engine";
import { OperationError, type Notice, type Profile, type Roster } from "./model";

/**
 * Saved teams. A captain creates the team and invites players; invited
 * players accept or decline. Captains register a saved team for an event in
 * one step. Pure functions: the server action saves the result.
 */

export interface RosterOutcome {
  roster: Roster;
  notices: Notice[];
  message: string;
}

const MAX_MEMBERS = 10;
const lower = (h: string) => h.toLowerCase();
const link = "/teams";

export function createRoster(id: string, captain: Profile | undefined, name: string, game: GameId): RosterOutcome {
  if (!captain) throw new OperationError("Sign in to create a team.", "forbidden");
  if (!GAMES[game]) throw new OperationError("Pick a game.");
  const clean = name.trim().replace(/\s+/g, " ");
  if (clean.length < 2 || clean.length > 40) throw new OperationError("Team names are 2 to 40 characters.");
  const role = captain.accounts.find((a) => a.game === game)?.roles[0] ?? GAMES[game].roles[0];
  return {
    roster: { id, name: clean, game, captain: captain.handle, members: [{ handle: captain.handle, role, status: "active" }] },
    notices: [],
    message: `${clean} is ready. Invite your teammates.`,
  };
}

export function invite(r: Roster, actor: string, profile: Profile | undefined, handle: string, role: string | null): RosterOutcome {
  if (lower(actor) !== lower(r.captain)) throw new OperationError("Only the captain can invite players.", "forbidden");
  if (!profile) throw new OperationError(`There's no player called ${handle}.`, "not_found");
  if (r.members.some((m) => lower(m.handle) === lower(profile.handle))) throw new OperationError(`${profile.handle} is already on ${r.name}.`, "conflict");
  if (r.members.length >= MAX_MEMBERS) throw new OperationError(`Teams can have up to ${MAX_MEMBERS} players, subs included.`);
  if (role && !GAMES[r.game].roles.includes(role)) throw new OperationError(`Pick a ${GAMES[r.game].name} role.`);
  return {
    roster: { ...r, members: [...r.members, { handle: profile.handle, role, status: "invited" }] },
    notices: [{ recipient: profile.handle, kind: "team", body: `${r.captain} invited you to join ${r.name} (${GAMES[r.game].name}).`, link }],
    message: `Invited ${profile.handle}. They'll see it in their notifications.`,
  };
}

export function respond(r: Roster, actor: string, accept: boolean): RosterOutcome {
  const me = r.members.find((m) => lower(m.handle) === lower(actor));
  if (!me || me.status !== "invited") throw new OperationError("There's no invite to answer.", "not_found");
  return {
    roster: accept ? { ...r, members: r.members.map((m) => (m === me ? { ...m, status: "active" } : m)) } : { ...r, members: r.members.filter((m) => m !== me) },
    notices: [{ recipient: r.captain, kind: "team", body: `${me.handle} ${accept ? "joined" : "declined the invite to"} ${r.name}.`, link }],
    message: accept ? `You're on ${r.name}.` : "Invite declined.",
  };
}

/** The captain removes someone, or a member leaves. The captain can't leave their own team. */
export function removeMember(r: Roster, actor: string, handle: string): RosterOutcome {
  const target = r.members.find((m) => lower(m.handle) === lower(handle));
  if (!target) throw new OperationError(`${handle} isn't on ${r.name}.`, "not_found");
  const self = lower(actor) === lower(handle);
  if (!self && lower(actor) !== lower(r.captain)) throw new OperationError("Only the captain can remove players.", "forbidden");
  if (lower(handle) === lower(r.captain)) throw new OperationError("Captains can't leave their own team. Make someone else captain first.", "conflict");
  return {
    roster: { ...r, members: r.members.filter((m) => m !== target) },
    notices: [{ recipient: self ? r.captain : target.handle, kind: "team", body: self ? `${target.handle} left ${r.name}.` : `${r.captain} removed you from ${r.name}.`, link }],
    message: self ? `You left ${r.name}.` : `Removed ${target.handle}.`,
  };
}

export function makeCaptain(r: Roster, actor: string, handle: string): RosterOutcome {
  if (lower(actor) !== lower(r.captain)) throw new OperationError("Only the captain can hand over the team.", "forbidden");
  const target = r.members.find((m) => lower(m.handle) === lower(handle) && m.status === "active");
  if (!target) throw new OperationError(`${handle} needs to be an active member first.`, "conflict");
  return {
    roster: { ...r, captain: target.handle },
    notices: [{ recipient: target.handle, kind: "team", body: `${r.captain} made you captain of ${r.name}.`, link }],
    message: `${target.handle} is now captain.`,
  };
}

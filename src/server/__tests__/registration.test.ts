import { describe, expect, it } from "vitest";
import { GAMES, type Player } from "@/engine";
import { closeTicket, openTicket, postAnnouncement, replyTicket } from "../community";
import { createTournament, draftIssues, newDraft } from "../create";
import { demoProfiles, demoRosters, demoTournaments } from "../demo-data";
import { OperationError, type Ctx, type Outcome, type TournamentAgg } from "../model";
import * as op from "../operations";
import { buildSoloTeams, joinSolo, leaveSolo, registerTeam, withdrawTeam } from "../registration";
import { createRoster, invite, removeMember, respond } from "../rosters";

const NOW = new Date("2026-10-12T16:00:00Z");
let n = 0;
const ctx = (actor: string): Ctx => ({ now: NOW, actor, newId: () => `id-${++n}` });
const all = demoTournaments(NOW);
const profiles = demoProfiles(all);
const profile = (h: string) => profiles.find((p) => p.handle === h);
const event = (name: string) => structuredClone(all.find((t) => t.name === name)!);
const rosterOf = (name: string) => demoRosters().find((r) => r.name === name)!;
const refused = (fn: () => unknown, msg: RegExp) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(OperationError);
    expect((e as Error).message).toMatch(msg);
    return;
  }
  throw new Error("expected a refusal");
};
const hotCoffee = () => ({ name: "Hot Coffee", players: rosterOf("Hot Coffee").members.map((m) => ({ handle: m.handle, role: m.role! })) });

describe("team registration", () => {
  it("registers a saved team whose ranks fit, and tells the players and host", () => {
    const t = event("Ascendant Ladder Night");
    const out = registerTeam(t, ctx("glint"), hotCoffee(), profiles);
    const team = Object.values(out.agg.state.teams).find((x) => x.name === "Hot Coffee")!;
    expect(team.captain).toBe("glint");
    expect(team.players.every((p) => !p.checkedIn && p.verified === "api")).toBe(true);
    expect(out.agg.state.slots).toHaveLength(12);
    expect(out.message).toBe("Hot Coffee is registered. 4 spots left.");
    expect(out.effects.notices.map((x) => x.recipient).sort()).toEqual(["crumb", "delta", "iris", "koi", "mako_tv"]);
  });

  it("checks roles, the captain, duplicates and every player's rank", () => {
    const t = event("Ascendant Ladder Night");
    const entry = hotCoffee();
    refused(() => registerTeam(t, ctx("glint"), { ...entry, players: entry.players.map((p) => ({ ...p, role: "Duelist" })) }, profiles), /1 Duelist, 1 Initiator/);
    refused(() => registerTeam(t, ctx("ember"), entry, profiles), /Captains play on the team/);
    const eco = { name: "Eco Round", players: rosterOf("Eco Round").members.map((m) => ({ handle: m.handle, role: m.role! })) };
    refused(() => registerTeam(t, ctx(eco.players[0].handle), eco, profiles), /vanta is Platinum 2; this event is for Diamond 1 to Immortal 3/);
    const once = registerTeam(t, ctx("glint"), entry, profiles).agg;
    refused(() => registerTeam(once, ctx("glint"), { ...entry, name: "Hot Coffee 2" }, profiles), /already in this event/);
  });

  it("lets the captain withdraw, but not someone else", () => {
    const t = registerTeam(event("Ascendant Ladder Night"), ctx("glint"), hotCoffee(), profiles).agg;
    const id = Object.values(t.state.teams).find((x) => x.name === "Hot Coffee")!.id;
    refused(() => withdrawTeam(t, ctx("ember"), id), /captain or the host/);
    expect(withdrawTeam(t, ctx("glint"), id).agg.state.slots).toHaveLength(11);
  });
});

describe("solo sign-up and balancing", () => {
  it("adds eligible players to the pool once", () => {
    const t = event("Strategist Social");
    const out = joinSolo(t, ctx("zorra"), "Duelist", profile("zorra"));
    expect(out.agg.pool.at(-1)).toMatchObject({ handle: "zorra", role: "Duelist", verified: "self" });
    refused(() => joinSolo(out.agg, ctx("zorra"), "Duelist", profile("zorra")), /already signed up/);
    refused(() => joinSolo(t, ctx("ember"), "Duelist", profile("ember")), /hasn't linked a Marvel Rivals account/);
    expect(leaveSolo(out.agg, ctx("zorra")).agg.pool).toHaveLength(t.pool.length);
  });

  it("builds even teams with every role filled, then check-in can open", () => {
    const t = event("Midnight Spike Rush");
    const roles = GAMES.val.roles;
    const extra: Player[] = Array.from({ length: 40 - t.pool.length }, (_, i) => ({ handle: `fill${i}`, role: roles[(t.pool.length + i) % 5], score: 8 + (i % 6), verified: "api", checkedIn: false }));
    const full: TournamentAgg = { ...t, pool: [...t.pool, ...extra] };
    refused(() => buildSoloTeams(t, ctx("staticc")), /needs 40 players; 22 have signed up/);
    const out = buildSoloTeams(full, ctx("staticc"));
    const teams = Object.values(out.agg.state.teams);
    expect(teams).toHaveLength(8);
    for (const team of teams) expect(team.players.map((p) => p.role).sort()).toEqual([...roles].sort());
    expect(out.agg.pool).toEqual([]);
    expect(out.message).toMatch(/Built 8 teams/);
    expect(op.openCheckin(out.agg, ctx("staticc")).agg.status).toBe("checkin");
  });
});

describe("announcements and tickets", () => {
  it("sends announcements to everyone or just captains", () => {
    const t = event("Friday Night Spike");
    const all = postAnnouncement(t, ctx("kestrel"), "Round 2 starts at 8.", "all");
    expect(all.effects.notices).toHaveLength(40);
    expect(postAnnouncement(t, ctx("kestrel"), "Captains: check your DMs.", "captains").effects.notices).toHaveLength(8);
    refused(() => postAnnouncement(t, ctx("glint"), "hi", "all"), /Only the host/);
  });

  it("runs a ticket from open to answered to closed", () => {
    let t: TournamentAgg = event("Friday Night Spike");
    const step = (o: Outcome) => (t = o.agg);
    step(openTicket(t, ctx("glint"), { category: "result", subject: "M4 score", body: "We won 2-1, not 2-0." }));
    const k = t.tickets.at(-1)!;
    expect(k).toMatchObject({ openedBy: "glint", teamId: "hot-coffee", status: "open" });
    refused(() => replyTicket(t, ctx("lynx"), k.id, "hey"), /Only the host and the player/);
    step(replyTicket(t, ctx("kestrel"), k.id, "Fixed, thanks."));
    expect(t.tickets.at(-1)!.status).toBe("answered");
    step(closeTicket(t, ctx("glint"), k.id));
    expect(t.tickets.at(-1)!.status).toBe("closed");
    refused(() => openTicket(t, ctx("kestrel"), { category: "other", subject: "x", body: "y" }), /Only players/);
  });
});

describe("hosting a tournament", () => {
  it("blocks publisher-banned names and suggests the checks", () => {
    const d = { ...newDraft(NOW), name: "Saturday Night Cup" };
    expect(draftIssues(d, 90, NOW).some((i) => i.level === "block" && i.code === "name.netease")).toBe(true);
    refused(() => createTournament(d, ctx("kestrel"), profile("kestrel")), /NetEase doesn't allow "cup"/);
  });

  it("publishes a valid draft with registration open", () => {
    const d = { ...newDraft(NOW), name: "Saturday Night Social", game: "ow" as const, owSixes: true, signupType: "team" as const, rankMinTier: 2, rankMaxTier: 5 };
    const out = createTournament(d, ctx("kestrel"), profile("kestrel"));
    expect(out.agg).toMatchObject({ status: "registration", host: "kestrel", teamCount: 8, rankMin: 10, rankMax: 29 });
    expect(out.agg.roles).toHaveLength(6);
    expect(out.message).toBe("Saturday Night Social is published. Registration is open.");
  });

  it("refuses a start time in the past", () => {
    refused(() => createTournament({ ...newDraft(NOW), name: "Late Night Social", startsAt: "2026-10-01T00:00:00Z" }, ctx("kestrel"), profile("kestrel")), /30 minutes from now/);
  });
});

describe("saved teams", () => {
  it("creates, invites, accepts and removes", () => {
    let r = createRoster("r1", profile("kestrel"), "Kestrel's Crew", "val").roster;
    expect(r.members).toEqual([{ handle: "kestrel", role: "Duelist", status: "active" }]);
    const inv = invite(r, "kestrel", profile("ember"), "ember", "Initiator");
    expect(inv.notices[0]).toMatchObject({ recipient: "ember" });
    r = respond(inv.roster, "ember", true).roster;
    expect(r.members.find((m) => m.handle === "ember")!.status).toBe("active");
    refused(() => invite(r, "ember", profile("vexa"), "vexa", null), /Only the captain/);
    refused(() => removeMember(r, "kestrel", "kestrel"), /Captains can't leave/);
    expect(removeMember(r, "ember", "ember").roster.members).toHaveLength(1);
  });
});

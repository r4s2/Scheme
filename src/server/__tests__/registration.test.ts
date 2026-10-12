import { describe, expect, it } from "vitest";
import { GAMES, type Player } from "@/engine";
import { closeTicket, openTicket, postAnnouncement, replyTicket } from "../community";
import { createTournament, draftIssues, newDraft } from "../create";
import { demoProfiles, demoRosters, demoTournaments } from "../demo-data";
import { OperationError, type Ctx, type Outcome, type TournamentAgg } from "../model";
import * as op from "../operations";
import { buildSoloTeams, ineligibility, joinSolo, leaveSolo, rankNote, registerTeam, respondToRoster, updateRoster, withdrawTeam } from "../registration";
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
  it("registers a saved team whose ranks fit, and asks the players to confirm", () => {
    const t = event("Ascendant Ladder Night");
    const out = registerTeam(t, ctx("glint"), hotCoffee(), profiles);
    const team = Object.values(out.agg.state.teams).find((x) => x.name === "Hot Coffee")!;
    expect(team.captain).toBe("glint");
    expect(team.players.every((p) => !p.checkedIn && p.verified === "api")).toBe(true);
    expect(team.players.find((p) => p.handle === "glint")!.confirmation).toBeUndefined();
    expect(team.players.filter((p) => p.confirmation === "pending")).toHaveLength(4);
    expect(out.agg.state.slots).toHaveLength(12);
    expect(out.message).toBe("Hot Coffee is registered. 4 spots left. 4 teammates will get a notification to confirm.");
    const asked = out.effects.notices.filter((x) => x.kind === "roster_confirm");
    expect(asked.map((x) => x.recipient).sort()).toEqual(["crumb", "delta", "iris", "koi"]);
    expect(asked[0].body).toMatch(/^glint added you to Hot Coffee for Ascendant Ladder Night as a starter\. Confirm/);
    expect(out.effects.notices.find((x) => x.kind === "registration")!.recipient).toBe("mako_tv");
  });

  it("checks the captain, duplicates and every player's rank", () => {
    const t = event("Ascendant Ladder Night");
    const entry = hotCoffee();
    refused(() => registerTeam(t, ctx("ember"), entry, profiles), /Captains play on the team/);
    const eco = { name: "Eco Round", players: rosterOf("Eco Round").members.map((m) => ({ handle: m.handle, role: m.role! })) };
    refused(() => registerTeam(t, ctx(eco.players[0].handle), eco, profiles), /vanta is Platinum 2; this event is for Diamond 1 to Immortal 3/);
    const once = registerTeam(t, ctx("glint"), entry, profiles).agg;
    refused(() => registerTeam(once, ctx("glint"), { ...entry, name: "Hot Coffee 2" }, profiles), /already in this event/);
  });

  it("lets flexible games pick any composition, but holds fixed ones to their lineup", () => {
    // Valorant has no fixed composition: five Duelists is a legal lineup.
    const val = hotCoffee();
    expect(() => registerTeam(event("Ascendant Ladder Night"), ctx("glint"), { ...val, players: val.players.map((p) => ({ ...p, role: "Duelist" })) }, profiles)).not.toThrow();
    refused(() => registerTeam(event("Ascendant Ladder Night"), ctx("glint"), { ...val, players: val.players.map((p) => ({ ...p, role: "Tank" })) }, profiles), /Pick a role for every starter/);
    // Overwatch is role queue: 1 Tank, 2 Damage, 2 Support.
    const ow = event("Payload Pals Scrim Night");
    const sb = rosterOf("Shield Bash");
    const lineup = sb.members.map((m, i) => ({ handle: m.handle, role: GAMES.ow.roles[i] }));
    refused(() => registerTeam(ow, ctx(sb.captain), { name: "Shield Bash", players: lineup.map((p) => ({ ...p, role: "Damage" })) }, profiles), /1 Tank, 2 Damage, 2 Support/);
    expect(registerTeam(ow, ctx(sb.captain), { name: "Shield Bash", players: lineup }, profiles).message).toMatch(/^Shield Bash is registered\. The event is full\./);
  });

  it("takes subs on top of the starters, up to the event's limit, in any role", () => {
    const t = event("Ascendant Ladder Night");
    expect(t.benchMax).toBe(2);
    const subs = [{ handle: "ember", role: "Flex" }, { handle: "vexa", role: "Sentinel" }];
    refused(() => registerTeam(t, ctx("glint"), { ...hotCoffee(), bench: [...subs, { handle: "kestrel", role: "Flex" }] }, profiles), /up to 2 subs/);
    refused(() => registerTeam(t, ctx("glint"), { ...hotCoffee(), bench: [{ handle: "", role: "Flex" }] }, profiles), /empty sub slot/);
    refused(() => registerTeam(t, ctx("glint"), { ...hotCoffee(), bench: [{ handle: "ember", role: "Support" }] }, profiles), /Pick a role for every sub/);
    refused(() => registerTeam(t, ctx("glint"), { ...hotCoffee(), bench: [{ handle: "koi", role: "Flex" }] }, profiles), /listed twice/);
    const ok = (handle: string) => !ineligibility(t, profile(handle), handle);
    const bench = subs.filter((x) => ok(x.handle));
    expect(bench.length).toBeGreaterThan(0);
    const out = registerTeam(t, ctx("glint"), { ...hotCoffee(), bench }, profiles);
    const team = Object.values(out.agg.state.teams).find((x) => x.name === "Hot Coffee")!;
    expect(team.players).toHaveLength(5);
    expect(team.bench!.map((p) => [p.handle, p.role, p.confirmation])).toEqual(bench.map((b) => [b.handle, b.role, "pending"]));
    expect(out.effects.notices.find((x) => x.recipient === bench[0].handle)!.body).toMatch(/as a sub\./);
    // A sub counts as in the event (no second team), and withdrawing tells them too.
    refused(() => addToAnotherTeam(out.agg, bench[0].handle), new RegExp(`${bench[0].handle} is already in this event`));
    expect(withdrawTeam(out.agg, ctx("glint"), team.id).effects.notices.map((x) => x.recipient)).toContain(bench[0].handle);
  });

  it("lets the captain withdraw, but not someone else", () => {
    const t = registerTeam(event("Ascendant Ladder Night"), ctx("glint"), hotCoffee(), profiles).agg;
    const id = Object.values(t.state.teams).find((x) => x.name === "Hot Coffee")!.id;
    refused(() => withdrawTeam(t, ctx("ember"), id), /captain or the host/);
    expect(withdrawTeam(t, ctx("glint"), id).agg.state.slots).toHaveLength(11);
  });
});

/** Try to add a player to another team's bench. */
function addToAnotherTeam(agg: TournamentAgg, handle: string) {
  const team = Object.values(agg.state.teams)[0];
  return updateRoster(agg, ctx(team.captain), team.id, { name: team.name, players: team.players.map((p) => ({ handle: p.handle, role: p.role })), bench: [{ handle, role: "Flex" }] }, profiles);
}

describe("confirming a spot and editing the roster", () => {
  const registered = () => {
    const agg = registerTeam(event("Ascendant Ladder Night"), ctx("glint"), hotCoffee(), profiles).agg;
    return { agg, team: Object.values(agg.state.teams).find((x) => x.name === "Hot Coffee")! };
  };

  it("records each player's answer and tells the captain", () => {
    const { agg } = registered();
    const yes = respondToRoster(agg, ctx("koi"), true);
    expect(yes.message).toBe("You're confirmed for Hot Coffee.");
    expect(yes.effects.notices).toEqual([expect.objectContaining({ recipient: "glint", body: expect.stringMatching(/koi confirmed/) })]);
    const team = () => Object.values(yes.agg.state.teams).find((x) => x.name === "Hot Coffee")!;
    expect(team().players.find((p) => p.handle === "koi")!.confirmation).toBeUndefined();
    refused(() => respondToRoster(yes.agg, ctx("koi"), false), /already confirmed/);
    refused(() => respondToRoster(yes.agg, ctx("glint"), true), /already confirmed/);
    refused(() => respondToRoster(yes.agg, ctx("ember"), true), /aren't on a team/);

    const no = respondToRoster(yes.agg, ctx("crumb"), false);
    expect(Object.values(no.agg.state.teams).find((x) => x.name === "Hot Coffee")!.players.find((p) => p.handle === "crumb")!.confirmation).toBe("declined");
    expect(no.effects.notices[0].body).toMatch(/crumb can't play for Hot Coffee.*Edit your roster/);
    // Changing their mind is fine until the captain replaces them.
    expect(respondToRoster(no.agg, ctx("crumb"), true).message).toMatch(/confirmed/);
  });

  it("lets the captain swap players and add subs, keeping answers for those who stay", () => {
    const { agg: a0, team } = registered();
    const agg = respondToRoster(a0, ctx("koi"), true).agg;
    const elig = (h: string) => !ineligibility(agg, profile(h), h);
    const swapIn = ["ember", "vexa", "kestrel"].find(elig)!;
    const players = team.players.map((p) => ({ handle: p.handle === "crumb" ? swapIn : p.handle, role: p.role }));
    refused(() => updateRoster(agg, ctx("koi"), team.id, { name: team.name, players }, profiles), /Only the captain/);
    const out = updateRoster(agg, ctx("glint"), team.id, { name: "Hot Coffee", players, bench: [{ handle: "crumb", role: "Flex" }] }, profiles);
    const after = out.agg.state.teams[team.id];
    expect(after.players.find((p) => p.handle === "koi")!.confirmation).toBeUndefined();
    expect(after.players.find((p) => p.handle === "iris")!.confirmation).toBe("pending");
    expect(after.players.find((p) => p.handle === swapIn)!.confirmation).toBe("pending");
    // crumb moved to the bench: still pending, and not asked twice.
    expect(after.bench).toEqual([expect.objectContaining({ handle: "crumb", role: "Flex", confirmation: "pending" })]);
    expect(out.effects.notices.map((x) => x.recipient)).toEqual([swapIn]);
    expect(out.message).toBe("Roster saved. 1 new player will get a notification to confirm.");
    // Dropping a player tells them.
    const dropped = updateRoster(out.agg, ctx("glint"), team.id, { name: "Hot Coffee", players }, profiles);
    expect(dropped.effects.notices).toEqual([expect.objectContaining({ recipient: "crumb", body: expect.stringMatching(/took you off/) })]);
    expect(dropped.agg.state.teams[team.id].bench).toEqual([]);
  });
});

describe("rank ranges", () => {
  const withRule = (rule: TournamentAgg["rankRule"]) => ({ ...event("Ascendant Ladder Night"), rankRule: rule });
  const vanta = () => profile("vanta");

  it("only blocks players outside a required range", () => {
    expect(ineligibility(withRule("required"), vanta(), "vanta")).toMatch(/vanta is Platinum 2; this event is for Diamond 1 to Immortal 3/);
    expect(ineligibility(withRule("suggested"), vanta(), "vanta")).toBeNull();
    expect(rankNote(withRule("suggested"), vanta())).toBe("Outside the suggested Diamond 1 to Immortal 3");
    expect(rankNote(withRule("required"), vanta())).toBeNull();
    expect(ineligibility(withRule("open"), vanta(), "vanta")).toBeNull();
    expect(rankNote(withRule("open"), vanta())).toBeNull();
  });

  it("lets the wizard publish with no range, a suggested one or a required one", () => {
    const base = { ...newDraft(NOW), name: "Range Night", game: "val" as const, rankMinTier: 4, rankMaxTier: 5 };
    expect(createTournament({ ...base, rankRule: "open" }, ctx("kestrel"), profile("kestrel")).agg).toMatchObject({ rankRule: "open", rankMin: 0, rankMax: 24 });
    expect(createTournament({ ...base, rankRule: "suggested" }, ctx("kestrel"), profile("kestrel")).agg).toMatchObject({ rankRule: "suggested", rankMin: 12, rankMax: 17 });
    refused(() => createTournament({ ...base, rankRule: "sometimes" as never }, ctx("kestrel"), profile("kestrel")), /how the rank range works/);
    refused(() => createTournament({ ...base, signupType: "team", benchMax: 9 }, ctx("kestrel"), profile("kestrel")), /0 to 4 subs/);
    expect(createTournament({ ...base, signupType: "team", benchMax: 3 }, ctx("kestrel"), profile("kestrel")).agg.benchMax).toBe(3);
    expect(createTournament({ ...base, signupType: "solo", benchMax: 3 }, ctx("kestrel"), profile("kestrel")).agg.benchMax).toBe(0);
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
    const d = { ...newDraft(NOW), name: "Saturday Night Social", game: "ow" as const, owSixes: true, signupType: "team" as const, rankRule: "required" as const, rankMinTier: 2, rankMaxTier: 5 };
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

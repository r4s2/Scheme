/**
 * Runs the Postgres store against a real database. Skipped unless
 * TEST_DATABASE_URL points at a freshly migrated and seeded database, e.g.
 * after `supabase db reset` locally. It changes data, so never point it at
 * production.
 */
import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildBracket, findMatch, GAMES, lockedSlots, resultOf } from "@/engine";
import { openTicket, postAnnouncement, replyTicket } from "../community";
import { createTournament, newDraft } from "../create";
import { joinSolo, leaveSolo, registerTeam, respondToRoster, updateRoster, withdrawTeam } from "../registration";
import { createRoster, invite } from "../rosters";
import type { Ctx, TournamentAgg } from "../model";
import * as op from "../operations";
import { PostgresStore } from "../store/postgres";
import { ConflictError } from "../store/types";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("PostgresStore (integration)", () => {
  const sql = postgres(url ?? "postgres://unused", { max: 2 });
  const store = new PostgresStore(sql);
  afterAll(() => sql.end());

  let tid = "";
  const ctx = (actor: string, at = new Date()): Ctx => ({ now: at, actor, newId: () => crypto.randomUUID() });
  const teamByName = (agg: TournamentAgg, name: string) => Object.values(agg.state.teams).find((t) => t.name === name)!.id;

  it("loads the seeded tournament into engine state", async () => {
    const list = await store.list();
    const fns = list.find((t) => t.name === "Friday Night Spike")!;
    expect(fns).toMatchObject({ status: "live", host: "kestrel", game: "val" });
    tid = fns.id;
    const agg = (await store.get(tid))!;
    expect(agg.state.slots).toHaveLength(8);
    expect(Object.keys(agg.state.results)).toHaveLength(2);
    const b = buildBracket(agg.state);
    expect(findMatch(b, "M5")!.a).toBe(teamByName(agg, "Tilt Proof"));
    expect(agg.state.teams[teamByName(agg, "Hot Coffee")].captain).toBe("glint");
  });

  it("persists reports, confirms matching ones, and records audit and notifications", async () => {
    let agg = (await store.get(tid))!;
    const hc = teamByName(agg, "Hot Coffee");
    let out = op.submitReport(agg, ctx("glint"), "M4", hc, 2, 1);
    agg = await store.commit(agg, out);
    expect(agg.reports).toHaveLength(1);
    expect((await store.notifications("lynx"))[0].body).toMatch(/reported M4/);

    out = op.submitReport(agg, ctx("lynx"), "M4", hc, 2, 1);
    agg = await store.commit(agg, out);
    expect(agg.reports).toHaveLength(0);
    expect(resultOf(agg.state, findMatch(buildBracket(agg.state), "M4"))).toMatchObject({ winner: hc, by: "reports" });
    const log = await store.auditLog(tid);
    expect(log.some((e) => e.action === "result.record" && e.summary.includes("M4"))).toBe(true);
  });

  it("returns from a save exactly what a fresh load would read", async () => {
    const norm = (t: TournamentAgg) => ({
      ...t,
      state: { ...t.state, teams: Object.fromEntries(Object.entries(t.state.teams).map(([k, v]) => [k, { ...v, players: [...v.players].sort((a, b) => a.handle.localeCompare(b.handle)) }])) },
    });
    let agg = (await store.get(tid))!;
    const slots = [...agg.state.slots];
    const free = slots.map((_, i) => i).filter((i) => !lockedSlots(agg.state, slots, agg.state.format).has(i));
    [slots[free[0]], slots[free[1]]] = [slots[free[1]], slots[free[0]]];
    agg = await store.commit(agg, op.arrangeBracket(agg, ctx("kestrel"), slots, agg.state.format, "swap"));
    expect(norm(agg)).toEqual(norm((await store.get(tid))!));
    agg = await store.commit(agg, op.arrangeBracket(agg, ctx("kestrel"), [...agg.state.slots], "double", "transform"));
    expect(norm(agg)).toEqual(norm((await store.get(tid))!));
    agg = await store.commit(agg, op.arrangeBracket(agg, ctx("kestrel"), [...agg.state.slots], "single", "undo"));
  });

  it("rejects a save from a stale copy", async () => {
    const stale = (await store.get(tid))!;
    const fresh = await store.commit(stale, op.extendMatch(stale, ctx("kestrel"), "M2", 2));
    expect(fresh.version).toBe(stale.version + 1);
    await expect(store.commit(stale, op.extendMatch(stale, ctx("kestrel"), "M2", 2))).rejects.toBeInstanceOf(ConflictError);
  });

  it("closes a paid event, writes payouts, and lets winners claim after release", async () => {
    await sql`update tournaments set entry_fee_cents = 1000 where id = ${tid}`;
    let agg = (await store.get(tid))!;
    for (let i = 0; i < 10; i++) {
      const b = buildBracket(agg.state);
      if (b.complete) break;
      const m = b.matches.find((x) => x.a && x.b && !resultOf(agg.state, x))!;
      agg = await store.commit(agg, op.hostRecordResult(agg, ctx("kestrel"), m.id, m.a!, 2, 0));
    }
    const closedAt = new Date();
    agg = await store.commit(agg, op.closeTournament(agg, ctx("kestrel", closedAt), { method: "bracket", message: "GGs, thanks for playing!" }));
    expect(agg.status).toBe("complete");
    expect(agg.closure!.places.map((p) => p.length)).toEqual([1, 1, 1]);
    // $10 × 8 teams = $80 pool → $48 / $24 / $8, five players each.
    expect(agg.payouts.reduce((s, p) => s + p.cents, 0)).toBe(8000);

    const jobs = op.runDueJobs(agg, new Date(closedAt.getTime() + 25 * 3_600_000))!;
    agg = await store.commit(agg, jobs);
    const winner = agg.payouts.find((p) => p.place === 1)!.handle;
    agg = await store.commit(agg, op.claimPayout(agg, ctx(winner)));
    const reloaded = (await store.get(tid))!;
    expect(reloaded.payouts.filter((p) => p.handle === winner).every((p) => p.status === "claimed")).toBe(true);
    expect(reloaded.closure!.message).toBe("GGs, thanks for playing!");
  });

  it("publishes a wizard draft and runs team registration through to check-in", async () => {
    const draft = { ...newDraft(new Date()), name: "Integration Night Showdown", game: "val" as const, signupType: "team" as const, teamCount: 4 as const, rankMinTier: 0, rankMaxTier: 8, verifiedOnly: false, paid: true, entryFeeDollars: 5, withholdPct: 0 };
    const created = createTournament(draft, ctx("kestrel"), (await store.profiles(["kestrel"]))[0]);
    let agg = await store.create(created.agg, created.effects);
    expect(agg).toMatchObject({ status: "registration", teamCount: 4, payoutSplit: [60, 30, 10], entryFeeCents: 500 });
    expect((await store.list()).some((t) => t.name === "Integration Night Showdown")).toBe(true);

    // Register four saved teams; withdraw one and register it again.
    const rosters = ["Hot Coffee", "Night Shift", "Paper Tigers", "Second Wind"];
    for (const name of rosters) {
      const r = (await store.rosters(name === "Hot Coffee" ? "glint" : name === "Night Shift" ? "harbor" : name === "Paper Tigers" ? "pebble" : "quill")).find((x) => x.name === name)!;
      const players = GAMES.val.roles.map((role, i) => ({ handle: r.members.find((m) => m.role === role)?.handle ?? r.members[i].handle, role }));
      agg = await store.commit(agg, registerTeam(agg, ctx(r.captain), { name, players }, await store.profiles(players.map((p) => p.handle))));
    }
    expect(Object.keys(agg.state.teams)).toHaveLength(4);
    const hc = Object.values(agg.state.teams).find((t) => t.name === "Hot Coffee")!;
    agg = await store.commit(agg, withdrawTeam(agg, ctx("glint"), hc.id));
    expect(Object.keys((await store.get(agg.id))!.state.teams)).toHaveLength(3);
    const back = rosterPlayers(await store.rosters("glint"), "Hot Coffee");
    agg = await store.commit(agg, registerTeam(agg, ctx("glint"), { name: "Hot Coffee", players: back }, await store.profiles(back.map((p) => p.handle))));
    agg = await store.commit(agg, op.openCheckin(agg, ctx("kestrel")));
    expect(agg.status).toBe("checkin");
    expect(agg.state.slots).toHaveLength(4);

    // Announcements and tickets survive a reload.
    agg = await store.commit(agg, postAnnouncement(agg, ctx("kestrel"), "Check in by 7:45.", "captains"));
    agg = await store.commit(agg, openTicket(agg, ctx("glint"), { category: "schedule", subject: "Late start?", body: "Can we start 15 minutes late?" }));
    const ticket = agg.tickets[0];
    agg = await store.commit(agg, replyTicket(agg, ctx("kestrel"), ticket.id, "Yes, that's fine."));
    const reloaded = (await store.get(agg.id))!;
    expect(reloaded.announcements.map((a) => [a.audience, a.body])).toEqual([["captains", "Check in by 7:45."]]);
    expect(reloaded.tickets[0]).toMatchObject({ status: "answered", openedBy: "glint" });
    expect(reloaded.tickets[0].messages.map((m) => m.author)).toEqual(["glint", "kestrel"]);
  });

  it("saves subs, the lineup order and each player's answer", async () => {
    const draft = { ...newDraft(new Date()), name: "Integration Sub Night", game: "val" as const, signupType: "team" as const, teamCount: 4 as const, rankRule: "suggested" as const, rankMinTier: 4, rankMaxTier: 6, benchMax: 2, verifiedOnly: false };
    const created = createTournament(draft, ctx("kestrel"), (await store.profiles(["kestrel"]))[0]);
    let agg = await store.create(created.agg, created.effects);
    expect(agg).toMatchObject({ rankRule: "suggested", benchMax: 2 });
    expect((await store.list()).find((t) => t.name === "Integration Sub Night")!.rankRule).toBe("suggested");

    const players = rosterPlayers(await store.rosters("glint"), "Hot Coffee").reverse();
    players.unshift(...players.splice(players.findIndex((p) => p.handle === "glint"), 1));
    const bench = [{ handle: "ember", role: "Flex" }];
    agg = await store.commit(agg, registerTeam(agg, ctx("glint"), { name: "Hot Coffee", players, bench }, await store.profiles([...players, ...bench].map((p) => p.handle))));
    const id = teamByName(agg, "Hot Coffee");
    const loaded = (await store.get(agg.id))!;
    expect(loaded.state.teams[id]).toEqual(agg.state.teams[id]);
    expect(loaded.state.teams[id].players.map((p) => p.handle)).toEqual(players.map((p) => p.handle));
    expect(loaded.state.teams[id].bench).toEqual([expect.objectContaining({ handle: "ember", role: "Flex", confirmation: "pending" })]);
    expect((await store.notifications("ember"))[0]).toMatchObject({ kind: "roster_confirm", body: expect.stringMatching(/as a sub/) });

    agg = await store.commit(agg, respondToRoster(agg, ctx("ember"), true));
    agg = await store.commit(agg, respondToRoster(agg, ctx(players[1].handle), false));
    const after = (await store.get(agg.id))!.state.teams[id];
    expect(after.bench![0].confirmation).toBeUndefined();
    expect(after.players[1].confirmation).toBe("declined");
    // The captain moves the sub into the lineup and drops the player who can't make it.
    const lineup = players.map((p, i) => (i === 1 ? { handle: "ember", role: p.role } : p));
    agg = await store.commit(agg, updateRoster(agg, ctx("glint"), id, { name: "Hot Coffee", players: lineup, bench: [] }, await store.profiles(lineup.map((p) => p.handle))));
    const edited = (await store.get(agg.id))!.state.teams[id];
    expect(edited).toEqual(agg.state.teams[id]);
    expect(edited.players[1]).toMatchObject({ handle: "ember" });
    expect(edited.players[1].confirmation).toBeUndefined();
    expect(edited.bench).toEqual([]);
    // Subs show up as playing in the event.
    expect((await store.list()).find((t) => t.id === agg.id)!.players).toContain("ember");
  });

  it("searches players and edits game pools", async () => {
    const hits = await store.searchProfiles("gli", 5);
    expect(hits[0].handle).toBe("glint");
    expect(await store.searchProfiles("%", 5)).toEqual([]);
    expect((await store.searchProfiles("#NA1", 50)).length).toBeGreaterThan(5);

    await store.saveGameAccount("glint", { game: "lol", accountName: "glint#NA1", rankScore: 13, roles: ["Mid"], source: "api" });
    const lol = () => store.profiles(["glint"]).then(([p]) => p.accounts.find((a) => a.game === "lol"));
    expect(await lol()).toEqual({ game: "lol", accountName: "glint#NA1", rankScore: 13, roles: ["Mid"], source: "self" });
    await store.saveGameAccount("glint", { game: "lol", accountName: "glint#EUW", rankScore: 15, roles: ["Top", "Fill"], source: "self" });
    expect(await lol()).toMatchObject({ accountName: "glint#EUW", rankScore: 15, roles: ["Top", "Fill"] });
    await store.removeGameAccount("glint", "lol");
    expect(await lol()).toBeUndefined();

    const val = (await store.profiles(["glint"]))[0].accounts.find((a) => a.game === "val")!;
    await store.saveGameAccount("glint", { ...val, accountName: "fake#000", rankScore: 1, roles: ["Sentinel"] });
    expect((await store.profiles(["glint"]))[0].accounts.find((a) => a.game === "val")).toEqual({ ...val, roles: ["Sentinel"] });
    await store.saveGameAccount("glint", val);
  });

  it("keeps solo sign-ups and builds teams from them", async () => {
    const s = (await store.list()).find((t) => t.name === "Strategist Social")!;
    let agg = (await store.get(s.id))!;
    const before = agg.pool.length;
    agg = await store.commit(agg, joinSolo(agg, ctx("kestrel"), "Duelist", (await store.profiles(["kestrel"]))[0]));
    expect((await store.get(s.id))!.pool.map((p) => p.handle)).toContain("kestrel");
    agg = await store.commit(agg, leaveSolo(agg, ctx("kestrel")));
    expect((await store.get(s.id))!.pool).toHaveLength(before);
  });

  it("saves whether a player is looking for a team", async () => {
    await store.setLookingForTeam("ember", true);
    expect((await store.profiles(["ember"]))[0].lookingForTeam).toBe(true);
    await store.setLookingForTeam("ember", false);
    expect((await store.directory()).find((p) => p.handle === "ember")!.lookingForTeam).toBe(false);
  });

  it("saves teams, invites and notifications", async () => {
    const r = createRoster(crypto.randomUUID(), (await store.profiles(["kestrel"]))[0], "Integration Crew", "ow").roster;
    await store.saveRoster(r);
    const inv = invite(r, "kestrel", (await store.profiles(["ember"]))[0], "ember", "Tank");
    await store.saveRoster(inv.roster);
    await store.notify(inv.notices);
    expect((await store.rosters("ember")).find((x) => x.id === r.id)!.members.find((m) => m.handle === "ember")!.status).toBe("invited");
    expect((await store.notifications("ember"))[0].body).toMatch(/invited you to join Integration Crew/);
  });
});

function rosterPlayers(rs: { name: string; members: { handle: string; role: string | null }[] }[], name: string) {
  const r = rs.find((x) => x.name === name)!;
  return GAMES.val.roles.map((role, i) => ({ handle: r.members.find((m) => m.role === role)?.handle ?? r.members[i].handle, role }));
}

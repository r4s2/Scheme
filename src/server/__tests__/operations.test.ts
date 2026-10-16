import { describe, expect, it } from "vitest";
import { buildBracket, findMatch, resultOf } from "@/engine";
import { demoTournaments } from "../demo-data";
import { OperationError, type Ctx, type Outcome, type TournamentAgg } from "../model";
import * as op from "../operations";
import { deskItems } from "../views";

const NOW = new Date("2026-10-09T22:00:00Z");
let n = 0;
const ctx = (actor: string, at: Date = NOW): Ctx => ({ now: at, actor, newId: () => `id${++n}` });
const live = () => demoTournaments(NOW)[0];
const checkin = () => demoTournaments(NOW)[1];
const later = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const result = (agg: TournamentAgg, id: string) => resultOf(agg.state, findMatch(buildBracket(agg.state), id));

function expectRefused(fn: () => Outcome, code: OperationError["code"], msg?: RegExp) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(OperationError);
    expect((e as OperationError).code).toBe(code);
    if (msg) expect((e as Error).message).toMatch(msg);
    return;
  }
  throw new Error("Expected the operation to be refused");
}

describe("permissions", () => {
  it("only the host can enter results, edit the bracket or close", () => {
    const t = live();
    expectRefused(() => op.hostRecordResult(t, ctx("glint"), "M2", "night-shift", 2, 0), "forbidden");
    expectRefused(() => op.seedBracket(t, ctx("glint")), "forbidden");
    expectRefused(() => op.closeTournament(t, ctx("glint"), { method: "standings", message: "x" }), "forbidden");
  });

  it("only captains in the match can report it", () => {
    const t = live();
    expectRefused(() => op.submitReport(t, ctx("harbor"), "M4", "hot-coffee", 2, 0), "forbidden"); // Night Shift's captain
    expectRefused(() => op.submitReport(t, ctx("pebble"), "M4", "hot-coffee", 2, 0), "forbidden"); // not a captain
  });
});

describe("reporting", () => {
  it("matching reports lock the result and advance the winner", () => {
    let t = live();
    const r1 = op.submitReport(t, ctx("glint"), "M4", "hot-coffee", 2, 1);
    expect(r1.effects.notices.map((x) => x.recipient)).toEqual(["lynx"]);
    t = r1.agg;
    t = op.submitReport(t, ctx("lynx"), "M4", "hot-coffee", 2, 1).agg;
    expect(result(t, "M4")).toMatchObject({ winner: "hot-coffee", by: "reports" });
    expect(t.reports).toEqual([]);
    expect(findMatch(buildBracket(t.state), "M6")!.b).toBe("hot-coffee");
  });

  it("different reports open a dispute for the host", () => {
    let t = live();
    t = op.submitReport(t, ctx("glint"), "M4", "hot-coffee", 2, 1).agg;
    const out = op.submitReport(t, ctx("lynx"), "M4", "backline-bandits", 2, 1);
    expect(out.agg.disputes).toHaveLength(1);
    expect(out.effects.notices.some((x) => x.recipient === "kestrel" && x.kind === "dispute")).toBe(true);
    expect(deskItems(out.agg, NOW).disputes).toHaveLength(1);
    expectRefused(() => op.submitReport(out.agg, ctx("glint"), "M4", "hot-coffee", 2, 0), "conflict", /dispute/);
  });

  it("the host can rule for one side or order a replay", () => {
    let t = live();
    t = op.submitReport(t, ctx("glint"), "M4", "hot-coffee", 2, 1).agg;
    t = op.submitReport(t, ctx("lynx"), "M4", "backline-bandits", 2, 1).agg;
    const id = t.disputes[0].id;
    const ruled = op.resolveDispute(t, ctx("kestrel"), id, "backline-bandits").agg;
    expect(result(ruled, "M4")).toMatchObject({ winner: "backline-bandits", by: "dispute" });
    expect(ruled.disputes[0].status).toBe("resolved");
    const replay = op.orderReplay(t, ctx("kestrel"), id).agg;
    expect(result(replay, "M4")).toBeNull();
    expect(replay.reports).toEqual([]);
    expect(replay.schedule.overrides.M4).toBe(later(24).toISOString());
  });

  it("a lone report auto-confirms after 12 hours", () => {
    const t = op.submitReport(live(), ctx("glint"), "M4", "hot-coffee", 2, 0).agg;
    expect(op.runDueJobs(t, later(11))).toBeNull();
    const out = op.runDueJobs(t, later(12))!;
    expect(result(out.agg, "M4")).toMatchObject({ winner: "hot-coffee", by: "auto" });
  });
});

describe("host results and deadlines", () => {
  it("records, forfeits and reopens", () => {
    let t = live();
    t = op.forfeitMatch(t, ctx("kestrel"), "M2", "night-shift").agg;
    expect(result(t, "M2")).toMatchObject({ winner: "night-shift", w: 2, l: 0, by: "forfeit" });
    t = op.reopenMatch(t, ctx("kestrel"), "M2").agg;
    expect(result(t, "M2")).toBeNull();
  });

  it("refuses to reopen a result a later match depends on", () => {
    let t = live();
    t = op.hostRecordResult(t, ctx("kestrel"), "M2", "night-shift", 2, 0).agg;
    t = op.hostRecordResult(t, ctx("kestrel"), "M5", "tilt-proof", 2, 1).agg;
    expectRefused(() => op.reopenMatch(t, ctx("kestrel"), "M1"), "conflict", /later match/);
  });

  it("shows overdue matches on the desk and clears them when extended", () => {
    let t = live();
    expect(deskItems(t, NOW).overdue.map((o) => o.match.id)).toEqual(["M2"]);
    t = op.extendMatch(t, ctx("kestrel"), "M2", 6).agg;
    expect(deskItems(t, NOW).overdue).toEqual([]);
  });

  it("approves extension requests by moving the deadline", () => {
    const t = live();
    const before = Date.parse(t.schedule.overrides.M4);
    const out = op.decideExtension(t, ctx("kestrel"), "x1", true).agg;
    expect(Date.parse(out.schedule.overrides.M4) - before).toBe(3_600_000);
    expect(out.extensions[0].status).toBe("approved");
    expectRefused(() => op.decideExtension(out, ctx("kestrel"), "x1", true), "not_found");
  });

  it("blocks duplicate extension requests and respects the host's setting", () => {
    const t = live();
    expectRefused(() => op.requestExtension(t, ctx("glint"), "M4", 2, "again"), "conflict");
    expectRefused(() => op.requestExtension({ ...t, allowExtensions: false }, ctx("harbor"), "M2", 2, "late"), "forbidden");
    expect(op.requestExtension(t, ctx("harbor"), "M2", 2, "late").agg.extensions).toHaveLength(2);
  });
});

describe("bracket edits", () => {
  it("swaps open teams and refuses locked ones", () => {
    const t = live();
    expect(op.swapTeams(t, ctx("kestrel"), 2, 6).agg.state.slots.slice(2, 7)).toEqual(["hot-coffee", "paper-tigers", "low-ground", "second-wind", "night-shift"]);
    expectRefused(() => op.swapTeams(t, ctx("kestrel"), 0, 6), "conflict", /locked/);
  });

  it("transforms format only while results are round-one pairings", () => {
    const t = live();
    expect(op.transformBracket(t, ctx("kestrel"), "double").agg.state.format).toBe("double");
    let u = op.hostRecordResult(t, ctx("kestrel"), "M2", "night-shift", 2, 0).agg;
    u = op.hostRecordResult(u, ctx("kestrel"), "M5", "tilt-proof", 2, 0).agg;
    expectRefused(() => op.transformBracket(u, ctx("kestrel"), "double"), "conflict", /locked/);
  });
});

describe("check-in and start", () => {
  it("players check themselves in, and the host can force a check-in", () => {
    let t = checkin();
    const missing = t.state.teams["team-basalt"].players[4];
    expectRefused(() => op.checkIn(t, ctx("not-a-player")), "forbidden");
    t = op.checkIn(t, ctx(t.state.teams["team-drift"].players[2].handle)).agg;
    expect(t.state.teams["team-drift"].players[2].checkedIn).toBe(true);
    expectRefused(() => op.markCheckedIn(t, ctx(missing.handle), "team-basalt", missing.handle), "forbidden");
    t = op.markCheckedIn(t, ctx("kestrel"), "team-basalt", missing.handle).agg;
    expect(t.state.teams["team-basalt"].players[4].checkedIn).toBe(true);
  });

  it("the host rejects a team; it keeps its spot and forfeits its matches", () => {
    let t = checkin();
    expectRefused(() => op.rejectTeam(t, ctx("zorra"), "team-basalt", ""), "forbidden");
    const out = op.rejectTeam(t, ctx("kestrel"), "team-basalt", "Two players missing ranks");
    t = out.agg;
    expect(t.state.teams["team-basalt"].rejected).toBe("Two players missing ranks");
    expect(out.effects.notices.map((n) => n.recipient)).toEqual(t.state.teams["team-basalt"].players.map((p) => p.handle));
    expectRefused(() => op.rejectTeam(t, ctx("kestrel"), "team-basalt", ""), "conflict", /already rejected/);
    // Reversible until play starts.
    const back = op.reinstateTeam(t, ctx("kestrel"), "team-basalt").agg;
    expect(back.state.teams["team-basalt"].rejected).toBeUndefined();
    // Never fewer than two teams left.
    let u = op.rejectTeam(t, ctx("kestrel"), "team-cinder", "").agg;
    expect(u.state.teams["team-cinder"].rejected).toMatch(/requirements/);
    expectRefused(() => op.rejectTeam(u, ctx("kestrel"), "team-drift", ""), "conflict", /two teams/);

    const started = op.startTournament(t, ctx("kestrel"));
    expect(started.message).toMatch(/1 match went to the opponents of rejected teams by forfeit/);
    const m = buildBracket(started.agg.state).matches.find((x) => x.a === "team-basalt" || x.b === "team-basalt")!;
    const r = resultOf(started.agg.state, m)!;
    expect(r).toMatchObject({ by: "forfeit" });
    expect(r.winner).not.toBe("team-basalt");
    expect(started.effects.notices.filter((n) => n.kind === "start").map((n) => n.recipient)).not.toContain(t.state.teams["team-basalt"].players[0].handle);
    expectRefused(() => op.reinstateTeam(started.agg, ctx("kestrel"), "team-basalt"), "conflict");

    // Two rejected teams meeting: one advances and forfeits its next match too.
    u = op.startTournament(u, ctx("kestrel")).agg;
    const b = buildBracket(u.state);
    const final = b.matches.find((x) => x.id === "M3")!;
    expect(b.matches.filter((x) => resultOf(u.state, x)?.by === "forfeit").length).toBeGreaterThanOrEqual(2);
    if (final.a && final.b) expect([u.state.teams[final.a].rejected, u.state.teams[final.b].rejected].filter(Boolean).length).toBeLessThan(2);
  });

  it("starting sets real deadlines", () => {
    const t = op.startTournament(checkin(), ctx("kestrel")).agg;
    expect(t.status).toBe("live");
    expect(t.schedule.waveDeadlines[0]).toBe(later(24).toISOString());
    expect(deskItems(t, NOW).overdue).toEqual([]);
  });
});

describe("closing", () => {
  function playOut(t: TournamentAgg): TournamentAgg {
    for (let i = 0; i < 20; i++) {
      const b = buildBracket(t.state);
      if (b.complete) return t;
      const m = b.matches.find((x) => x.a && x.b && !resultOf(t.state, x))!;
      t = op.hostRecordResult(t, ctx("kestrel"), m.id, m.a!, 2, 0).agg;
    }
    return t;
  }

  it("uses the bracket winner when the bracket is done and notifies everyone", () => {
    const t = playOut(op.startTournament(checkin(), ctx("kestrel")).agg);
    const out = op.closeTournament(t, ctx("kestrel"), { method: "pick", pick: "team-drift", message: "GGs everyone!" });
    expect(out.agg.status).toBe("complete");
    expect(out.agg.closure!.method).toBe("bracket");
    expect(out.agg.closure!.places[0]).toEqual(["team-aurora"]);
    expect(out.effects.notices.filter((x) => x.kind === "closed")).toHaveLength(24);
  });

  it("splits the paid pool per player in cents and releases after 24 hours", () => {
    const t = playOut(op.startTournament(checkin(), ctx("kestrel")).agg);
    const closed = op.closeTournament(t, ctx("kestrel"), { method: "bracket", message: "GG" }).agg;
    // $30 × 4 teams = $120 pool, 60/30/10 → $72 / $36 / $12, six players each.
    const byPlace = [1, 2, 3].map((p) => closed.payouts.filter((x) => x.place === p).reduce((s, x) => s + x.cents, 0));
    expect(byPlace).toEqual([7200, 3600, 1200]);
    expect(closed.payouts.filter((x) => x.place === 1).map((x) => x.cents)).toEqual([1200, 1200, 1200, 1200, 1200, 1200]);
    const winner = closed.payouts[0].handle;
    expectRefused(() => op.claimPayout(closed, ctx(winner)), "conflict", /unlocks/);
    const released = op.runDueJobs(closed, later(25))!.agg;
    const claimed = op.claimPayout(released, ctx(winner, later(25)));
    expect(claimed.message).toMatch(/\$12\.00 claimed/);
    expectRefused(() => op.claimPayout(claimed.agg, ctx(winner)), "conflict", /already/);
  });

  it("lets the host choose co-winners for an unfinished bracket and adds a prize", () => {
    const t = op.startTournament(checkin(), ctx("kestrel")).agg;
    const out = op.closeTournament(t, ctx("kestrel"), {
      method: "co_winners",
      coWinners: ["team-aurora", "team-cinder"],
      message: "Called it early, thanks all",
      prize: { name: "Signed jersey", claim: "Reply with a shipping address by Oct 16." },
    });
    expect(out.agg.closure!.places[0]).toEqual(["team-aurora", "team-cinder"]);
    const winNotices = out.effects.notices.filter((x) => x.kind === "win");
    expect(winNotices).toHaveLength(12);
    expect(winNotices[0].body).toMatch(/Signed jersey/);
  });

  it("cancels with a reason and refuses changes afterwards", () => {
    const out = op.cancelTournament(checkin(), ctx("kestrel"), "Not enough players checked in.");
    expect(out.message).toMatch(/Refunds/);
    expectRefused(() => op.seedBracket(out.agg, ctx("kestrel")), "conflict", /finished/);
  });
});

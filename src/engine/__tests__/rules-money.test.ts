import { describe, expect, it } from "vitest";
import { buildBracket, findMatch } from "../bracket";
import { blockedNameTerms, checkCompliance, hasBlockingIssues, suggestNames, type EventDraft } from "../compliance";
import { allocatePrizes, finalPlaces, needsTaxForm, playerShares, prizePoolCents, splitEvenly } from "../payouts";
import { evaluateReports, recordResult } from "../results";
import { autoConfirmAt, deadlineFor, extendDeadline, makeSchedule, matchStatus } from "../schedule";
import { makeState } from "./fixtures";

const draft = (o: Partial<EventDraft> = {}): EventDraft => ({
  game: "val",
  name: "Friday Night Spike",
  paid: false,
  entryFeeCents: 0,
  withholdPct: 0,
  split: [60, 30, 10],
  rankMinScore: 0,
  rankMaxScore: 20,
  participants: 40,
  riotVisibilityFormAcknowledged: true,
  hostKarma: 90,
  ...o,
});

describe("publisher naming rules", () => {
  it("blocks NetEase's words for Marvel Rivals only", () => {
    expect(blockedNameTerms("mr", "Saturday Night Cup")).toEqual(["cup"]);
    expect(blockedNameTerms("val", "Saturday Night Cup")).toEqual([]);
  });

  it("doesn't flag words that merely contain a blocked term", () => {
    expect(blockedNameTerms("mr", "Cupcake Clashers")).toEqual([]);
    expect(blockedNameTerms("mr", "Grand Finale")).toEqual([]);
  });

  it("blocks trademarks for every game", () => {
    expect(blockedNameTerms("lol", "Riot Night")).toContain("riot");
    expect(blockedNameTerms("ow", "Overwatch League Watch Party")).toContain("overwatch league");
  });

  it("blocks title sponsors for Overwatch", () => {
    expect(blockedNameTerms("ow", "Payload Night presented by Acme")).toContain("presented by");
  });

  it("suggests names without the blocked words", () => {
    expect(suggestNames("Saturday Night Cup", ["cup"])[0]).toBe("Saturday Night Showdown");
  });
});

describe("compliance checks", () => {
  it("passes a clean free event", () => {
    expect(hasBlockingIssues(checkCompliance(draft()))).toBe(false);
  });

  it("enforces Riot's 70% prize share and 20-participant minimum", () => {
    const codes = (d: EventDraft) => checkCompliance(d).filter((i) => i.level === "block").map((i) => i.code);
    expect(codes(draft({ paid: true, entryFeeCents: 2000, withholdPct: 30 }))).toEqual([]);
    expect(codes(draft({ paid: true, entryFeeCents: 2000, withholdPct: 31 }))).toContain("riot.prize_share");
    expect(codes(draft({ paid: true, entryFeeCents: 2000, participants: 15 }))).toContain("riot.min_participants");
  });

  it("enforces Blizzard's prizes-at-least-fees rule", () => {
    const issues = checkCompliance(draft({ game: "ow", name: "Tank Diff", paid: true, entryFeeCents: 1000, withholdPct: 5 }));
    expect(issues.map((i) => i.code)).toContain("blizzard.prizes_lt_fees");
  });

  it("requires the split to total 100% and enough host karma", () => {
    const issues = checkCompliance(draft({ paid: true, entryFeeCents: 1000, split: [50, 30], hostKarma: 40 }));
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("split.sum");
    expect(codes).toContain("host.karma");
  });
});

describe("reports", () => {
  const m = { a: "T1", b: "T2" };
  it("waits for the second captain", () => {
    expect(evaluateReports(m, [{ team: "T1", winner: "T1", w: 2, l: 1 }]).kind).toBe("waiting");
  });
  it("confirms matching reports", () => {
    const r = evaluateReports(m, [
      { team: "T1", winner: "T1", w: 2, l: 1 },
      { team: "T2", winner: "T1", w: 2, l: 1 },
    ]);
    expect(r).toEqual({ kind: "confirmed", result: { winner: "T1", w: 2, l: 1 } });
  });
  it("disputes different reports, including a different map count", () => {
    expect(
      evaluateReports(m, [
        { team: "T1", winner: "T1", w: 2, l: 0 },
        { team: "T2", winner: "T1", w: 2, l: 1 },
      ]).kind,
    ).toBe("disputed");
  });
});

describe("schedule", () => {
  const start = "2026-10-17T23:00:00.000Z";
  const sched = makeSchedule(start, 24, 3);

  it("gives each wave its own deadline and extends past the list", () => {
    expect(deadlineFor(sched, { id: "M1", wave: 0 }).toISOString()).toBe("2026-10-18T23:00:00.000Z");
    expect(deadlineFor(sched, { id: "M5", wave: 1 }).toISOString()).toBe("2026-10-19T23:00:00.000Z");
    expect(deadlineFor(sched, { id: "X", wave: 4 }).toISOString()).toBe("2026-10-22T23:00:00.000Z");
  });

  it("extends a single match without touching the rest", () => {
    const ext = extendDeadline(sched, { id: "M1", wave: 0 }, 6);
    expect(deadlineFor(ext, { id: "M1", wave: 0 }).toISOString()).toBe("2026-10-19T05:00:00.000Z");
    expect(deadlineFor(ext, { id: "M2", wave: 0 }).toISOString()).toBe("2026-10-18T23:00:00.000Z");
  });

  it("reports due and overdue matches", () => {
    const s = makeState(8);
    const m = findMatch(buildBracket(s), "M1")!;
    const ctx = { schedule: sched, live: true, hasPendingReport: false, hasOpenDispute: false };
    expect(matchStatus(s, m, { ...ctx, now: new Date("2026-10-18T20:00:00Z") })).toEqual({ kind: "due", hoursLeft: 3 });
    expect(matchStatus(s, m, { ...ctx, now: new Date("2026-10-19T01:30:00Z") })).toEqual({ kind: "overdue", hoursOver: 3 });
    const done = recordResult(s, "M1", "T1", 2, 0, "forfeit").state;
    expect(matchStatus(done, m, { ...ctx, now: new Date() }).kind).toBe("forfeit");
  });

  it("auto-confirms a lone report after 12 hours", () => {
    expect(autoConfirmAt("2026-10-18T10:00:00.000Z").toISOString()).toBe("2026-10-18T22:00:00.000Z");
  });
});

describe("closing and prizes", () => {
  it("uses the bracket champion when the bracket is complete", () => {
    let s = makeState(4);
    s = recordResult(s, "M1", "T1", 2, 0, "host").state;
    s = recordResult(s, "M2", "T3", 2, 0, "host").state;
    s = recordResult(s, "M3", "T3", 2, 1, "host").state;
    const fp = finalPlaces(buildBracket(s), { method: "pick", pick: "T1" });
    expect(fp.method).toBe("bracket");
    expect(fp.places[0]).toEqual(["T3"]);
    expect(fp.places[1]).toEqual(["T1"]);
  });

  it("lets the host pick, name co-winners, or use standings when unfinished", () => {
    const b = buildBracket(recordResult(makeState(8), "M1", "T1", 2, 0, "host").state);
    expect(finalPlaces(b, { method: "pick", pick: "T4" }).places[0]).toEqual(["T4"]);
    expect(finalPlaces(b, { method: "co_winners", coWinners: ["T1", "T3"] }).places[0]).toEqual(["T1", "T3"]);
    expect(finalPlaces(b, { method: "standings" }).places[0]).toEqual(["T1"]);
    expect(() => finalPlaces(b, { method: "co_winners", coWinners: ["T1"] })).toThrow(/two co-winners/);
    expect(() => finalPlaces(b, { method: "bracket" })).toThrow(/no winner/);
  });

  it("splits the pool in cents with nothing lost to rounding", () => {
    const pool = prizePoolCents(3000, 8, 0);
    expect(pool).toBe(24000);
    const prizes = allocatePrizes(pool, [60, 30, 10], [["A"], ["B"], ["C"]]);
    expect(prizes.map((p) => p.cents)).toEqual([14400, 7200, 2400]);
    const odd = allocatePrizes(10001, [60, 30, 10], [["A"], ["B"], ["C"]]);
    expect(odd.reduce((s, p) => s + p.cents, 0)).toBe(10001);
  });

  it("co-winners share the places they occupy", () => {
    const prizes = allocatePrizes(24000, [60, 30, 10], [["A", "B"], ["C"]]);
    expect(prizes).toEqual([
      { teamId: "A", place: 1, cents: 10800 },
      { teamId: "B", place: 1, cents: 10800 },
      { teamId: "C", place: 2, cents: 2400 },
    ]);
  });

  it("gives unused split to first place when fewer teams finish", () => {
    const prizes = allocatePrizes(10000, [60, 30, 10], [["A"], ["B"]]);
    expect(prizes.reduce((s, p) => s + p.cents, 0)).toBe(10000);
    expect(prizes[0].cents).toBe(7000);
  });

  it("splits a team prize per player to the cent", () => {
    expect(playerShares(14401, ["a", "b", "c", "d", "e", "f"]).map((s) => s.cents)).toEqual([2401, 2400, 2400, 2400, 2400, 2400]);
    expect(splitEvenly(5, 3)).toEqual([2, 2, 1]);
  });

  it("flags tax forms at the 2026 threshold", () => {
    expect(needsTaxForm(199_999)).toBe(false);
    expect(needsTaxForm(200_000)).toBe(true);
  });
});

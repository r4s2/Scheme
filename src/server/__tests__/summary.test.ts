import { describe, expect, it } from "vitest";
import { DEMO_HOST_KARMA, demoTournaments } from "../demo-data";
import { OperationError } from "../model";
import * as op from "../operations";
import { MemoryStore } from "../store/memory";
import { buildBoards, summarize } from "../summary";
import { startText } from "@/lib/format";

const NOW = new Date("2026-10-12T16:00:00Z"); // noon Eastern
const all = demoTournaments(NOW);
const byName = (n: string) => all.find((t) => t.name === n)!;

describe("sample data", () => {
  it("has live, check-in, open and closed events in every game but League's history", () => {
    const count = (s: string) => all.filter((t) => t.status === s).length;
    expect([count("live"), count("checkin"), count("registration"), count("complete")]).toEqual([1, 1, 8, 39]);
    expect(new Set(all.filter((t) => t.status === "registration").map((t) => t.game))).toEqual(new Set(["val", "mr", "ow", "lol"]));
  });

  it("never repeats a handle inside one tournament", () => {
    for (const t of all) {
      const hs = [...Object.values(t.state.teams).flatMap((x) => x.players.map((p) => p.handle)), ...t.subs.map((p) => p.handle), ...t.pool.map((p) => p.handle)];
      expect(new Set(hs).size, t.name).toBe(hs.length);
    }
  });

  it("is the same on every call", () => {
    expect(JSON.stringify(demoTournaments(NOW))).toBe(JSON.stringify(all));
  });
});

describe("library cards", () => {
  it("counts teams for team sign-ups and players for solo sign-ups", () => {
    expect(summarize(byName("Ascendant Ladder Night"), 95)).toMatchObject({ registered: 11, teamCount: 16, signupType: "team", hostKarma: 95 });
    expect(summarize(byName("Rift Rookies Open"), 84)).toMatchObject({ registered: 54, teamCount: 16, teamSize: 5, signupType: "solo" });
    expect(summarize(byName("Saturday Six-Stack Social"), 92)).toMatchObject({ registered: 24, teamSize: 6 });
  });

  it("names the winners of closed events", () => {
    expect(summarize(byName("Thursday Throwdown"), 91).winners).toEqual(["Strat Pack"]);
  });

  it("reads start times like the prototype", () => {
    const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
    expect(startText(at(9), NOW)).toBe("Tonight, 9:00 PM ET");
    expect(startText(at(1), NOW)).toBe("Today, 1:00 PM ET");
    expect(startText(at(24), NOW)).toBe("Tomorrow, 12:00 PM ET");
    expect(startText(at(24 * 3), NOW)).toBe("Thu, 12:00 PM ET");
    expect(startText(at(24 * 8), NOW)).toBe("Next Tue, 12:00 PM ET");
  });
});

describe("leaderboards", () => {
  it("ranks teams and players by tournaments won, with a board per game that has closed events", async () => {
    const boards = buildBoards(await new MemoryStore(all, DEMO_HOST_KARMA).wins());
    expect(boards.map((b) => b.label)).toEqual(["Teams", "Players", "Valorant", "Marvel Rivals", "Overwatch"]);
    expect(boards[0].rows.slice(0, 3)).toEqual([
      { name: "Tilt Proof", wins: 6, detail: "Valorant" },
      { name: "Dive Comp Dads", wins: 5, detail: "Marvel Rivals" },
      { name: "Low Ground", wins: 4, detail: "Valorant" },
    ]);
    // Everyone on Tilt Proof shares its six wins.
    expect(boards[1].rows.find((r) => r.name === "ember")).toEqual({ name: "ember", wins: 6, detail: "Valorant" });
  });

  it("counts a co-win for each team", () => {
    const boards = buildBoards([
      { tournamentId: "a", game: "ow", team: "A", players: ["x"], at: "" },
      { tournamentId: "a", game: "ow", team: "B", players: ["y"], at: "" },
    ]);
    expect(boards[0].rows.map((r) => r.wins)).toEqual([1, 1]);
  });
});

describe("opening check-in", () => {
  const ctx = { now: NOW, actor: "", newId: () => "id" };
  it("waits until every team spot is filled", () => {
    const t = byName("Ascendant Ladder Night");
    expect(() => op.openCheckin(t, { ...ctx, actor: "mako_tv" })).toThrow(/11 of 16 teams/);
  });
  it("waits for solo sign-ups to be balanced into teams", () => {
    const t = byName("Strategist Social");
    try {
      op.openCheckin(t, { ...ctx, actor: "wren_plays" });
      throw new Error("should refuse");
    } catch (e) {
      expect(e).toBeInstanceOf(OperationError);
      expect((e as Error).message).toMatch(/balanced/);
    }
  });
  it("opens once the event is full", () => {
    const t = byName("Ascendant Ladder Night");
    const full = { ...t, teamCount: Object.keys(t.state.teams).length };
    expect(op.openCheckin(full, { ...ctx, actor: "mako_tv" }).agg.status).toBe("checkin");
  });
});

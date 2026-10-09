import { describe, expect, it } from "vitest";
import { buildBracket, canReopen, findMatch, playableMatches } from "../bracket";
import { recordResult, reopenResult, EngineError } from "../results";
import type { FormatId, TournamentState } from "../types";
import { makeState } from "./fixtures";

/** Play every match: the earlier slot (stronger seed) wins unless `upset` says otherwise. */
function playOut(state: TournamentState, pickWinner?: (a: string, b: string) => string): TournamentState {
  let s = state;
  for (let guard = 0; guard < 200; guard++) {
    const b = buildBracket(s);
    if (b.complete) return s;
    const m = playableMatches(s, b)[0];
    if (!m) throw new Error(`Stuck: no playable match in ${s.format}`);
    const winner = pickWinner ? pickWinner(m.a!, m.b!) : m.a!;
    s = recordResult(s, m.id, winner, 2, 0, "host").state;
  }
  throw new Error("Did not finish");
}

describe("match counts", () => {
  const cases: [FormatId, number, number][] = [
    ["single", 8, 7],
    ["double", 8, 14],
    ["rr", 8, 28],
    ["groups", 8, 15],
    ["single", 4, 3],
    ["double", 4, 6],
    ["rr", 4, 6],
    ["single", 16, 15],
    ["double", 16, 30],
  ];
  it.each(cases)("%s with %i teams has %i matches", (format, n, expected) => {
    expect(buildBracket(makeState(n, format)).matches).toHaveLength(expected);
  });

  it("swiss with 8 teams plays 3 rounds of 4 once results come in", () => {
    const done = playOut(makeState(8, "swiss"));
    expect(buildBracket(done).matches).toHaveLength(12);
  });

  it("rejects non power-of-two fields", () => {
    expect(() => buildBracket(makeState(6))).toThrow(/power-of-two/);
  });
});

describe("every format plays through to one champion", () => {
  const formats: FormatId[] = ["single", "double", "rr", "swiss", "groups"];
  it.each(formats)("%s, favorites win", (format) => {
    const b = buildBracket(playOut(makeState(8, format)));
    expect(b.complete).toBe(true);
    expect(b.champion).toBe("T1");
    expect(b.standings[0].teamId).toBe("T1");
  });

  it.each(formats)("%s, underdogs win", (format) => {
    const b = buildBracket(playOut(makeState(8, format), (_a, bTeam) => bTeam));
    expect(b.complete).toBe(true);
    expect(b.champion).not.toBeNull();
    expect(new Set(b.matches.flatMap((m) => [m.a, m.b])).has(b.champion)).toBe(true);
  });
});

describe("single elimination", () => {
  it("advances winners into the next round", () => {
    let s = makeState(8);
    s = recordResult(s, "M1", "T2", 2, 1, "reports").state;
    s = recordResult(s, "M2", "T3", 2, 0, "reports").state;
    const m5 = findMatch(buildBracket(s), "M5")!;
    expect([m5.a, m5.b]).toEqual(["T2", "T3"]);
  });

  it("reports the champion only on the final result", () => {
    let s = makeState(4);
    s = recordResult(s, "M1", "T1", 2, 0, "host").state;
    const r2 = recordResult(s, "M2", "T3", 2, 0, "host");
    expect(r2.championDecided).toBeNull();
    const r3 = recordResult(r2.state, "M3", "T3", 2, 1, "host");
    expect(r3.championDecided).toBe("T3");
  });
});

describe("double elimination", () => {
  it("sends upper-bracket losers to the lower bracket", () => {
    let s = makeState(8, "double");
    s = recordResult(s, "M1", "T1", 2, 0, "host").state;
    s = recordResult(s, "M2", "T3", 2, 0, "host").state;
    const l1 = findMatch(buildBracket(s), "L1")!;
    expect([l1.a, l1.b]).toEqual(["T2", "T4"]);
  });

  it("a team with one loss can still win it all", () => {
    // T2 loses its first match (to T1), then wins everything after.
    let lostOnce = false;
    const b = buildBracket(
      playOut(makeState(8, "double"), (a, bTeam) => {
        if (a !== "T2" && bTeam !== "T2") return a;
        if (!lostOnce) {
          lostOnce = true;
          return a === "T2" ? bTeam : a;
        }
        return "T2";
      }),
    );
    expect(b.champion).toBe("T2");
  });
});

describe("editing results", () => {
  it("rejects a result for a team not in the match", () => {
    expect(() => recordResult(makeState(8), "M1", "T5", 2, 0, "host")).toThrow(EngineError);
  });

  it("rejects an impossible score", () => {
    expect(() => recordResult(makeState(8), "M1", "T1", 3, 0, "host")).toThrow(/valid Bo3/);
  });

  it("stores forfeits as a sweep", () => {
    const s = recordResult(makeState(8), "M1", "T2", 0, 0, "forfeit").state;
    expect(Object.values(s.results)[0]).toMatchObject({ winner: "T2", w: 2, l: 0, by: "forfeit" });
  });

  it("locks a result once a later match depends on it", () => {
    let s = makeState(8);
    s = recordResult(s, "M1", "T1", 2, 0, "host").state;
    s = recordResult(s, "M2", "T3", 2, 0, "host").state;
    expect(canReopen(s, buildBracket(s), findMatch(buildBracket(s), "M1")!)).toBe(true);
    s = recordResult(s, "M5", "T1", 2, 0, "host").state;
    expect(canReopen(s, buildBracket(s), findMatch(buildBracket(s), "M1")!)).toBe(false);
    expect(() => reopenResult(s, "M1")).toThrow(/later match/);
    expect(() => recordResult(s, "M1", "T2", 2, 0, "host")).toThrow(/later match/);
  });

  it("reopening clears the result and the downstream slot", () => {
    let s = makeState(8);
    s = recordResult(s, "M1", "T1", 2, 0, "host").state;
    s = reopenResult(s, "M1");
    expect(Object.keys(s.results)).toHaveLength(0);
    expect(findMatch(buildBracket(s), "M5")!.a).toBeNull();
  });

  it("never mutates the input state", () => {
    const s = makeState(8);
    recordResult(s, "M1", "T1", 2, 0, "host");
    expect(s.results).toEqual({});
  });
});

describe("standings", () => {
  it("ranks the champion first and the finalist second in single elimination", () => {
    // Slots are in id order, so the final is T1 (top half) vs T5 (bottom half).
    const b = buildBracket(playOut(makeState(8)));
    expect(b.standings.slice(0, 2).map((x) => x.teamId)).toEqual(["T1", "T5"]);
  });

  it("marks eliminated teams as not alive", () => {
    const s = recordResult(makeState(8), "M1", "T1", 2, 0, "host").state;
    const st = buildBracket(s).standings.find((x) => x.teamId === "T2")!;
    expect(st.alive).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { buildBracket, findMatch, pairKey } from "@/engine";
import { toEngineState, type TeamRow } from "./mapping";

const team = (id: string, captain: string, score: number): TeamRow => ({
  id,
  name: `Team ${id}`,
  captain_id: `${captain}-id`,
  tournament_players: [
    { profile_id: `${captain}-id`, role: "Duelist", rank_score: score, rank_source: "api", checked_in_at: "2026-10-09T00:00:00Z", profiles: { handle: captain } },
    { profile_id: `${id}-p2`, role: "Flex", rank_score: score, rank_source: "self", checked_in_at: null, profiles: { handle: `${id}-p2` } },
  ],
});

describe("toEngineState", () => {
  const ids = ["a", "b", "c", "d"];
  const rows = ids.map((id, i) => team(id, `cap${i}`, 10 - i));
  const t = { id: "t1", format: "single" as const, best_of: 3, slots: ids, wave_deadlines: ["2026-10-10T00:00:00Z"], deadline_overrides: null };

  it("maps teams, captains, players and check-in", () => {
    const { state } = toEngineState(t, rows, []);
    expect(state.teams.b.captain).toBe("cap1");
    expect(state.teams.a.players[1]).toMatchObject({ verified: "self", checkedIn: false });
  });

  it("feeds stored results into the bracket", () => {
    const { state, schedule } = toEngineState(t, rows, [
      { result_key: pairKey("a", "b"), match_id: "M1", winner_team_id: "b", w: 2, l: 1, source: "reports" },
    ]);
    expect(findMatch(buildBracket(state), "M3")!.a).toBe("b");
    expect(schedule.overrides).toEqual({});
  });

  it("rejects slots that point at missing teams", () => {
    expect(() => toEngineState({ ...t, slots: [...ids.slice(0, 3), "zzz"] }, rows, [])).toThrow(/unknown teams/);
  });
});

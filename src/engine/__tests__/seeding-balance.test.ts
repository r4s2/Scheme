import { describe, expect, it } from "vitest";
import { balanceTeams, rankSubs } from "../balance";
import { GAMES } from "../games";
import { recordResult } from "../results";
import { bracketOrder, canTransform, lockedSlots, randomizeSlots, seedSlots, swapSlots } from "../seeding";
import { makePool, makeState } from "./fixtures";

describe("seeding", () => {
  it("uses standard bracket order", () => {
    expect(bracketOrder(4)).toEqual([0, 3, 1, 2]);
  });

  it("pairs strongest with weakest and keeps top seeds apart", () => {
    const s = makeState(8);
    const shuffled = { ...s, slots: ["T5", "T2", "T8", "T1", "T3", "T7", "T6", "T4"] };
    const seeded = seedSlots(shuffled, shuffled.slots, "single");
    expect(seeded.slice(0, 2)).toEqual(["T1", "T8"]);
    // T1 and T2 land in opposite halves.
    const half = (t: string) => (seeded.indexOf(t) < 4 ? 0 : 1);
    expect(half("T1")).not.toBe(half("T2"));
  });

  it("snakes teams across groups so group averages are close", () => {
    const s = makeState(8, "groups");
    const seeded = seedSlots(s, s.slots, "groups");
    expect(seeded.slice(0, 4).sort()).toEqual(["T1", "T4", "T5", "T8"]);
  });

  it("keeps locked slots in place when randomizing and seeding", () => {
    const s = recordResult(makeState(8), "M1", "T1", 2, 0, "host").state;
    expect([...lockedSlots(s, s.slots, "single")]).toEqual([0, 1]);
    for (let seed = 1; seed < 20; seed++) {
      const r = randomizeSlots(s, s.slots, "single", seed);
      expect(r.slice(0, 2)).toEqual(["T1", "T2"]);
      expect([...r].sort()).toEqual([...s.slots].sort());
    }
    expect(seedSlots(s, s.slots, "single").slice(0, 2)).toEqual(["T1", "T2"]);
  });

  it("randomize always changes something when it can", () => {
    const s = makeState(4);
    expect(randomizeSlots(s, s.slots, "single", 7)).not.toEqual(s.slots);
  });

  it("refuses swaps that touch a locked team", () => {
    const s = recordResult(makeState(8), "M1", "T1", 2, 0, "host").state;
    expect(swapSlots(s, 0, 4)).toMatchObject({ ok: false });
    expect(swapSlots(s, 2, 4)).toMatchObject({ ok: true });
  });

  it("allows format changes only while results are round-one pairings", () => {
    let s = makeState(8);
    expect(canTransform(s)).toBe(true);
    s = recordResult(s, "M1", "T1", 2, 0, "host").state;
    s = recordResult(s, "M2", "T3", 2, 0, "host").state;
    expect(canTransform(s)).toBe(true);
    s = recordResult(s, "M5", "T1", 2, 0, "host").state;
    expect(canTransform(s)).toBe(false);
  });
});

describe("team balancing", () => {
  const roles = GAMES.mr.roles;

  it("fills every role on every team", () => {
    const { teams, shortRoles } = balanceTeams(makePool("mr", 8, 3), 8, roles, "even");
    expect(shortRoles).toEqual([]);
    for (const t of teams) expect(t.players.map((p) => p.role).sort()).toEqual([...roles].sort());
  });

  it("even teams are much closer than rank tiers", () => {
    const pool = makePool("mr", 8, 11);
    const even = balanceTeams(pool, 8, roles, "even");
    const tiers = balanceTeams(pool, 8, roles, "tiers");
    expect(even.spread).toBeLessThan(1);
    expect(tiers.spread).toBeGreaterThan(even.spread * 3);
  });

  it("is deterministic", () => {
    const pool = makePool("val", 4, 5);
    expect(balanceTeams(pool, 4, GAMES.val.roles, "even")).toEqual(balanceTeams(pool, 4, GAMES.val.roles, "even"));
  });

  it("sends extra players to the sub list and reports short roles", () => {
    const pool = makePool("val", 3, 9);
    const extra = { ...pool[0], handle: "extra-duelist" };
    const res = balanceTeams([...pool, extra], 3, GAMES.val.roles, "even");
    expect(res.unplaced).toHaveLength(1);
    const short = balanceTeams(pool.filter((p) => p.role !== "Sentinel" || p.handle !== pool.find((x) => x.role === "Sentinel")!.handle), 3, GAMES.val.roles, "even");
    expect(short.shortRoles).toEqual([{ role: "Sentinel", needed: 3, have: 2 }]);
  });

  it("suggests subs in the same role, then closest rank", () => {
    const subs = [
      { handle: "a", score: 10, role: "Tank", verified: "api" as const, checkedIn: true },
      { handle: "b", score: 15, role: "Support", verified: "api" as const, checkedIn: true },
      { handle: "c", score: 14, role: "Support", verified: "api" as const, checkedIn: true },
    ];
    expect(rankSubs({ role: "Support", score: 13 }, subs).map((s) => s.handle)).toEqual(["c", "b", "a"]);
  });
});

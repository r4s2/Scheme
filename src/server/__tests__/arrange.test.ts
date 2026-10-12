import { describe, expect, it } from "vitest";
import { randomizeSlots, seedSlots, swapSlots } from "@/engine";
import { demoTournaments } from "../demo-data";
import { OperationError } from "../model";
import * as op from "../operations";

const NOW = new Date("2026-10-12T16:00:00Z");
const ctx = (actor = "kestrel") => ({ now: NOW, actor, newId: () => "id" });
const fns = () => demoTournaments(NOW).find((t) => t.id === "friday-night-spike")!;
const sss = () => demoTournaments(NOW).find((t) => t.id === "saturday-six-stack")!;
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

describe("arranging the bracket from the board", () => {
  it("accepts what the board computed for a swap, and names the teams", () => {
    const t = fns();
    const r = swapSlots(t.state, 2, 7);
    if (!r.ok) throw new Error(r.reason);
    const out = op.arrangeBracket(t, ctx(), r.slots, t.state.format, "swap");
    expect(out.agg.state.slots).toEqual(r.slots);
    expect(out.message).toBe("Swapped Night Shift and Backline Bandits.");
    expect(out.effects.audit[0].action).toBe("bracket.swap");
  });

  it("accepts randomize and seed arrangements made with the engine", () => {
    const t = sss();
    const shuffled = randomizeSlots(t.state, t.state.slots, t.state.format, 7);
    expect(op.arrangeBracket(t, ctx(), shuffled, t.state.format, "randomize").message).toMatch(/Randomized/);
    const seeded = seedSlots({ ...t.state, slots: shuffled }, shuffled, t.state.format);
    const after = { ...t, state: { ...t.state, slots: shuffled } };
    if (seeded.some((s, i) => s !== shuffled[i])) expect(op.arrangeBracket(after, ctx(), seeded, t.state.format, "seed").message).toMatch(/Seeded/);
  });

  it("keeps teams with results where they are", () => {
    const t = fns();
    const slots = [...t.state.slots];
    [slots[0], slots[2]] = [slots[2], slots[0]]; // Tilt Proof has a result in M1
    refused(() => op.arrangeBracket(t, ctx(), slots, t.state.format, "swap"), /Tilt Proof has a confirmed result/);
  });

  it("refuses an arrangement with different teams", () => {
    const t = fns();
    refused(() => op.arrangeBracket(t, ctx(), [...t.state.slots.slice(1), "intruders"], t.state.format, "swap"), /doesn't match/);
  });

  it("changes format only while no results go past round one", () => {
    const t = sss();
    expect(op.arrangeBracket(t, ctx(), t.state.slots, "double", "transform").message).toBe("Changed the format to double elimination.");
  });

  it("is host-only, and refuses no-op changes", () => {
    const t = fns();
    refused(() => op.arrangeBracket(t, ctx("glint"), t.state.slots, t.state.format, "undo"), /host/i);
    refused(() => op.arrangeBracket(t, ctx(), t.state.slots, t.state.format, "undo"), /Nothing changed/);
  });
});

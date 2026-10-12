import { describe, expect, it } from "vitest";
import { fitsRank } from "@/components/home/cards";
import { demoProfiles, demoRosters, demoTournaments } from "../demo-data";
import { MemoryStore } from "../store/memory";
import { summarize } from "../summary";

const NOW = new Date("2026-10-12T16:00:00Z");
const all = demoTournaments(NOW);
const store = () => new MemoryStore(all, demoProfiles(all), demoRosters());

describe("player search", () => {
  it("finds players by handle or account name, exact and prefix matches first", async () => {
    const s = store();
    const hits = await s.searchProfiles("gl", 8);
    expect(hits[0].handle).toBe("glint");
    expect(hits.every((p) => p.handle.toLowerCase().includes("gl") || p.accounts.some((a) => a.accountName.toLowerCase().includes("gl")))).toBe(true);
    expect((await s.searchProfiles("GLINT", 8))[0].handle).toBe("glint");
    expect(await s.searchProfiles("   ", 8)).toEqual([]);
    expect(await s.searchProfiles("e", 3)).toHaveLength(3);
    // Account names count too: Overwatch BattleTags are capitalised handles.
    const byTag = await s.searchProfiles("#NA1", 50);
    expect(byTag.length).toBeGreaterThan(5);
  });
});

describe("editing the game pool", () => {
  it("adds self-reported games and edits them", async () => {
    const s = store();
    const before = (await s.profiles(["glint"]))[0];
    expect(before.accounts.some((a) => a.game === "lol")).toBe(false);
    await s.saveGameAccount("glint", { game: "lol", accountName: "glint#NA1", rankScore: 13, roles: ["Mid", "Fill"], source: "api" });
    let lol = (await s.profiles(["glint"]))[0].accounts.find((a) => a.game === "lol")!;
    // New accounts are always self-reported, whatever the form says.
    expect(lol).toEqual({ game: "lol", accountName: "glint#NA1", rankScore: 13, roles: ["Mid", "Fill"], source: "self" });
    await s.saveGameAccount("glint", { game: "lol", accountName: "glint#EUW", rankScore: 15, roles: ["Top"], source: "self" });
    lol = (await s.profiles(["glint"]))[0].accounts.find((a) => a.game === "lol")!;
    expect(lol).toMatchObject({ accountName: "glint#EUW", rankScore: 15, roles: ["Top"] });
    // Kept in the database's game order.
    expect((await s.profiles(["glint"]))[0].accounts.map((a) => a.game)).toEqual(["val", "lol"]);
    await s.removeGameAccount("glint", "lol");
    expect((await s.profiles(["glint"]))[0].accounts.map((a) => a.game)).toEqual(["val"]);
  });

  it("only changes the roles of a verified account", async () => {
    const s = store();
    const val = (await s.profiles(["glint"]))[0].accounts.find((a) => a.game === "val")!;
    expect(val.source).toBe("api");
    await s.saveGameAccount("glint", { ...val, accountName: "fake#000", rankScore: 24, roles: ["Sentinel"] });
    expect((await s.profiles(["glint"]))[0].accounts.find((a) => a.game === "val")).toEqual({ ...val, roles: ["Sentinel"] });
  });
});

describe("rank filter", () => {
  const card = { game: "val" as const, rankMin: 12, rankMax: 17, rankRule: "suggested" as const };
  it("matches events whose range overlaps a tier, and events with no range", () => {
    expect(fitsRank(card, "all", {})).toBe(true);
    expect(fitsRank(card, "4", {})).toBe(true); // Platinum 1-3 is 12-14
    expect(fitsRank(card, "5", {})).toBe(true); // Diamond is 15-17
    expect(fitsRank(card, "3", {})).toBe(false); // Gold is 9-11
    expect(fitsRank(card, "6", {})).toBe(false);
    expect(fitsRank({ ...card, rankRule: "open" }, "0", {})).toBe(true);
  });

  it("matches the viewer's own rank in each game", () => {
    expect(fitsRank(card, "mine", { val: 14 })).toBe(true);
    expect(fitsRank(card, "mine", { val: 20 })).toBe(false);
    expect(fitsRank(card, "mine", { ow: 14 })).toBe(false);
    expect(fitsRank({ ...card, rankRule: "open" }, "mine", {})).toBe(true);
  });
});

describe("subs in summaries", () => {
  it("counts subs as playing in the event, but not toward team size", () => {
    const t = all.find((x) => x.name === "Ascendant Ladder Night")!;
    const benched = Object.values(t.state.teams).flatMap((x) => x.bench ?? []);
    expect(benched.length).toBeGreaterThan(0);
    const sum = summarize(t, 90);
    expect(sum.teamSize).toBe(5);
    for (const p of benched) expect(sum.players).toContain(p.handle);
    expect(sum.rankRule).toBe("required");
  });
});

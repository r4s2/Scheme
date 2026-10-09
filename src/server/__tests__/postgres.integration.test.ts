/**
 * Runs the Postgres store against a real database. Skipped unless
 * TEST_DATABASE_URL points at a freshly migrated and seeded database, e.g.
 * after `supabase db reset` locally. It changes data, so never point it at
 * production.
 */
import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildBracket, findMatch, resultOf } from "@/engine";
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
});

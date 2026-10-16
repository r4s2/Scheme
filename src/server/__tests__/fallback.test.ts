import { describe, expect, it } from "vitest";
import { demoTournaments } from "../demo-data";
import type { TournamentAgg } from "../model";
import { DatabaseUnavailableError, describeDbError, FallbackStore, isConnectionError } from "../store/fallback";
import { MemoryStore } from "../store/memory";
import type { Store } from "../store/types";

const NOW = new Date("2026-10-09T22:00:00Z");
const timeout = () => Object.assign(new Error("write CONNECT_TIMEOUT db:5432"), { code: "CONNECT_TIMEOUT" });

/** A "database" whose network can be cut and restored. */
function setup() {
  const net = { up: true, pings: 0 };
  const dbData = new MemoryStore([{ ...demoTournaments(NOW)[0], id: "db-1", name: "From the database" }]);
  const db = new Proxy(dbData, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => (net.up ? v.apply(target, args) : Promise.reject(timeout()));
    },
  }) as Store;
  let clock = 0;
  const changes: boolean[] = [];
  const store = new FallbackStore(
    db,
    () => new MemoryStore(demoTournaments(NOW)),
    async () => {
      net.pings++;
      if (!net.up) throw timeout();
    },
    { retryMs: 30_000, now: () => clock, onChange: (online) => changes.push(online) },
  );
  return { net, store, dbData, changes, tick: (ms: number) => (clock += ms) };
}

const names = async (s: Store) => (await s.list()).map((t) => t.name);
const settle = () => new Promise((r) => setTimeout(r, 0));
const bump = (agg: TournamentAgg) => ({ agg: { ...agg, name: `${agg.name}!` }, effects: { audit: [], notices: [] } });

describe("development fallback store", () => {
  it("uses the database when it answers", async () => {
    const { store } = setup();
    expect(await names(store)).toEqual(["From the database"]);
    expect(store.online).toBe(true);
  });

  it("shows demo data when the database can't be reached, then reconnects on its own", async () => {
    const { net, store, changes, tick } = setup();
    net.up = false;
    expect(await names(store)).toContain("Friday Night Spike");
    expect(store.online).toBe(false);
    expect(store.problem).toMatchObject({ kind: "network", message: expect.stringMatching(/from this network \(CONNECT_TIMEOUT\)/) });

    net.up = true;
    tick(10_000);
    await store.list();
    expect(net.pings).toBe(1); // too soon to re-check

    tick(30_000);
    await store.list(); // kicks off a background check, still demo for this request
    await settle();
    expect(store.online).toBe(true);
    expect(await names(store)).toEqual(["From the database"]);
    expect(changes).toEqual([false, true]);
  });

  it("falls back mid-session when a read loses the connection", async () => {
    const { net, store } = setup();
    await store.list();
    net.up = false;
    expect(await names(store)).toContain("Friday Night Spike");
    expect(store.online).toBe(false);
  });

  it("never saves a database tournament into demo data", async () => {
    const { net, store, dbData } = setup();
    const t = (await store.get("db-1"))!;
    net.up = false;
    await expect(store.commit(t, bump(t))).rejects.toBeInstanceOf(DatabaseUnavailableError);
    expect(store.online).toBe(false);
    expect((await dbData.get("db-1"))?.name).toBe("From the database");
    expect(await names(store)).not.toContain("From the database!");
  });

  it("saves a demo tournament back to demo data even after the database returns", async () => {
    const { net, store, tick } = setup();
    net.up = false;
    const demoId = (await store.list())[0].id;
    const t = (await store.get(demoId))!;
    net.up = true;
    tick(60_000);
    await store.list();
    await settle();
    expect(store.online).toBe(true);
    const saved = await store.commit(t, bump(t));
    expect(saved.name).toBe(`${t.name}!`);
  });

  it("only treats network failures as connection errors", () => {
    expect(isConnectionError(timeout())).toBe(true);
    expect(isConnectionError(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isConnectionError(Object.assign(new Error("relation does not exist"), { code: "42P01" }))).toBe(false);
    expect(isConnectionError(null)).toBe(false);
  });
});

describe("explaining why the database is offline", () => {
  it("tells a blocked network from a paused project or a bad password", () => {
    expect(describeDbError(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" })).kind).toBe("network");
    expect(describeDbError(Object.assign(new Error("Tenant or user not found"), { code: "XX000" }))).toMatchObject({ kind: "paused", message: expect.stringMatching(/Supabase dashboard/) });
    expect(describeDbError(Object.assign(new Error('password authentication failed for user "postgres"'), { code: "28P01" })).kind).toBe("password");
    expect(describeDbError(new Error("something odd"))).toEqual({ kind: "other", message: "The database refused the connection: something odd" });
  });
});

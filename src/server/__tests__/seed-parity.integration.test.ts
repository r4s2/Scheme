/**
 * Checks that supabase/seed.sql, loaded into a real database, reads back the
 * same as the in-memory demo data it was generated from. Skipped unless
 * TEST_DATABASE_URL points at a freshly migrated and seeded database.
 *
 * Run it before the store integration test, which plays Friday Night Spike
 * out (CI does). Friday Night Spike's results are skipped here regardless.
 */
import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildBracket } from "@/engine";
import { demoProfiles, demoRosters, demoTournaments } from "../demo-data";
import type { TournamentAgg } from "../model";
import { MemoryStore } from "../store/memory";
import { PostgresStore } from "../store/postgres";

const url = process.env.TEST_DATABASE_URL;
const MUTATED = "Friday Night Spike";

describe.skipIf(!url)("seed.sql matches demo mode", () => {
  const sql = postgres(url ?? "postgres://unused", { max: 2 });
  const db = new PostgresStore(sql);
  const mem = new MemoryStore(demoTournaments(new Date()), demoProfiles(demoTournaments(new Date())), demoRosters());
  afterAll(() => sql.end());

  const byName = <T extends { name: string }>(xs: T[]) => new Map(xs.map((x) => [x.name, x]));
  const teamView = (t: TournamentAgg) =>
    Object.values(t.state.teams)
      .map((team) => ({
        name: team.name,
        captain: team.captain,
        players: team.players.map((p) => `${p.handle}/${p.role}/${p.score}/${p.verified}/${p.checkedIn}/${p.karma}`).sort(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  const nameOf = (t: TournamentAgg, id: string | null) => (id ? t.state.teams[id]?.name : null);

  it("lists the same tournaments with the same card details", async () => {
    const [a, b] = [byName(await db.list()), byName(await mem.list())];
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    for (const [name, x] of a) {
      const y = b.get(name)!;
      const strip = (t: typeof x) => ({ ...t, id: "", startsAt: "", players: [...t.players].sort() });
      expect(strip(x), name).toEqual(strip(y));
      // Seeded relative to now(), so start times agree to within the time since seeding.
      expect(Math.abs(Date.parse(x.startsAt) - Date.parse(y.startsAt)), name).toBeLessThan(6 * 3_600_000);
    }
  });

  it("has the same winners for the leaderboards", async () => {
    const view = (ws: { game: string; team: string; players: string[] }[]) => ws.map((w) => `${w.game}:${w.team}:${[...w.players].sort().join(",")}`).sort();
    expect(view(await db.wins())).toEqual(view(await mem.wins()));
  });

  it("has the same profiles, accounts and saved teams", async () => {
    const all = demoTournaments(new Date());
    const handles = demoProfiles(all).map((p) => p.handle);
    expect(await db.profiles(handles)).toEqual(await mem.profiles(handles));
    for (const h of ["glint", "kestrel", "zorra", "ember"]) {
      const strip = (rs: Awaited<ReturnType<typeof db.rosters>>) => rs.map(({ id, ...r }) => (void id, { ...r, members: [...r.members].sort((a, b) => a.handle.localeCompare(b.handle)) }));
      expect(strip(await db.rosters(h)), h).toEqual(strip(await mem.rosters(h)));
    }
  });

  it("has the same announcements and tickets", async () => {
    const fns = (await db.list()).find((t) => t.name === MUTATED)!;
    const [x, y] = [(await db.get(fns.id))!, (await mem.get("friday-night-spike"))!];
    const view = (t: TournamentAgg) => ({
      a: t.announcements.map((a) => [a.audience, a.body, a.sentBy]),
      k: t.tickets.map((k) => [k.openedBy, nameOf(t, k.teamId ?? null), k.matchId, k.category, k.subject, k.status, k.messages.map((m) => [m.author, m.body])]),
    });
    expect(view(x)).toEqual(view(y));
  });

  it("has the same people for the Acting as switcher", async () => {
    expect(await db.people()).toEqual(await mem.people());
  });

  it("loads every tournament the same way", async () => {
    const memList = byName(await mem.list());
    for (const s of await db.list()) {
      const [x, y] = [(await db.get(s.id))!, (await mem.get(memList.get(s.name)!.id))!];
      expect(teamView(x), s.name).toEqual(teamView(y));
      expect(x.state.slots.map((id) => nameOf(x, id)), s.name).toEqual(y.state.slots.map((id) => nameOf(y, id)));
      expect([x.pool.length, x.subs.map((p) => p.handle)], s.name).toEqual([y.pool.length, y.subs.map((p) => p.handle)]);
      if (s.name === MUTATED) continue;
      expect(x.closure?.places.map((g) => g.map((id) => nameOf(x, id))), s.name).toEqual(y.closure?.places.map((g) => g.map((id) => nameOf(y, id))));
      if (s.status === "registration") continue;
      const bx = buildBracket(x.state);
      const by = buildBracket(y.state);
      expect(nameOf(x, bx.champion), s.name).toEqual(nameOf(y, by.champion));
      expect(Object.keys(x.state.results).length, s.name).toBe(Object.keys(y.state.results).length);
      expect(x.extensions.map((e) => [e.matchId, nameOf(x, e.teamId), e.status]), s.name).toEqual(y.extensions.map((e) => [e.matchId, nameOf(y, e.teamId), e.status]));
    }
  });
});

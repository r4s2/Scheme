import { averageScore } from "./games";
import type { Bracket, BracketPart, Column, FormatId, Match, MatchResult, Standing, TournamentState } from "./types";

/** Order-independent key for a pairing: "a|b" with ids sorted. */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/**
 * Result keys are the pairing key, prefixed by stage when the same two teams
 * could meet twice (lower bracket "L", grand final "GF", playoffs "P").
 */
export function resultKeyFor(a: string | null, b: string | null, prefix = ""): string | null {
  if (!a || !b) return null;
  return (prefix ? `${prefix}:` : "") + pairKey(a, b);
}

interface MatchOpts {
  prefix?: string;
  pa?: string;
  pb?: string;
  sa?: number;
  sb?: number;
  wave?: number;
  depth?: number;
}

function makeMatch(id: string, a: string | null, b: string | null, o: MatchOpts = {}): Match {
  return {
    id,
    a: a ?? null,
    b: b ?? null,
    pa: o.pa,
    pb: o.pb,
    sa: o.sa,
    sb: o.sb,
    resultKey: resultKeyFor(a, b, o.prefix ?? ""),
    wave: o.wave ?? 0,
    depth: o.depth ?? 0,
  };
}

export function resultOf(state: Pick<TournamentState, "results">, m: Match | null | undefined): MatchResult | null {
  if (!m || !m.resultKey) return null;
  return state.results[m.resultKey] ?? null;
}

export function winnerOf(state: Pick<TournamentState, "results">, m: Match): string | null {
  return resultOf(state, m)?.winner ?? null;
}

export function loserOf(state: Pick<TournamentState, "results">, m: Match): string | null {
  const r = resultOf(state, m);
  if (!r) return null;
  return r.winner === m.a ? m.b : m.a;
}

interface FirstPair {
  a: string | null;
  b: string | null;
  pa?: string;
  pb?: string;
}

/** Single-elimination rounds. Optionally seeded from explicit first-round pairs (playoffs). */
export function eliminationRounds(
  state: Pick<TournamentState, "results">,
  slots: string[],
  opts: { idPrefix?: string; keyPrefix?: string; firstPairs?: FirstPair[]; depth0?: number; wave0?: number } = {},
): Match[][] {
  const { idPrefix = "M", keyPrefix = "", firstPairs, depth0 = 0, wave0 = 0 } = opts;
  let n = 1;
  const r1: Match[] = [];
  if (firstPairs) {
    for (const p of firstPairs) {
      r1.push(makeMatch(`${idPrefix}${n++}`, p.a, p.b, { prefix: keyPrefix, pa: p.pa, pb: p.pb, wave: wave0, depth: depth0 }));
    }
  } else {
    for (let i = 0; i < slots.length / 2; i++) {
      r1.push(
        makeMatch(`${idPrefix}${n++}`, slots[2 * i], slots[2 * i + 1], {
          prefix: keyPrefix,
          sa: 2 * i,
          sb: 2 * i + 1,
          wave: wave0,
          depth: depth0,
        }),
      );
    }
  }
  const rounds = [r1];
  let prev = r1;
  let ri = 1;
  while (prev.length > 1) {
    const next: Match[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      const p0 = prev[i];
      const p1 = prev[i + 1];
      const m = makeMatch(`${idPrefix}${n++}`, winnerOf(state, p0), winnerOf(state, p1), {
        prefix: keyPrefix,
        pa: `Winner ${p0.id}`,
        pb: `Winner ${p1.id}`,
        wave: wave0 + ri,
        depth: depth0 + ri,
      });
      p0.feeds = m.id;
      p1.feeds = m.id;
      next.push(m);
    }
    rounds.push(next);
    prev = next;
    ri++;
  }
  return rounds;
}

/** Lower bracket for double elimination, fed by upper-bracket losers. */
export function lowerRounds(state: Pick<TournamentState, "results">, upper: Match[][]): Match[][] {
  let n = 1;
  const out: Match[][] = [];
  const mk = (a: string | null, b: string | null, pa: string, pb: string) => {
    const i = out.length;
    return makeMatch(`L${n++}`, a, b, { prefix: "L", pa, pb, wave: i + 1, depth: upper.length + i });
  };
  let cur: Match[] = [];
  const r0 = upper[0];
  for (let i = 0; i < r0.length; i += 2) {
    cur.push(mk(loserOf(state, r0[i]), loserOf(state, r0[i + 1]), `Loser ${r0[i].id}`, `Loser ${r0[i + 1].id}`));
  }
  out.push(cur);
  for (let r = 1; r < upper.length; r++) {
    // Consolidate until the lower bracket matches the size of the next upper drop-in.
    while (cur.length > upper[r].length) {
      const nx: Match[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        const m = mk(winnerOf(state, cur[i]), winnerOf(state, cur[i + 1]), `Winner ${cur[i].id}`, `Winner ${cur[i + 1].id}`);
        cur[i].feeds = m.id;
        cur[i + 1].feeds = m.id;
        nx.push(m);
      }
      out.push(nx);
      cur = nx;
    }
    // Upper losers drop in, reversed to avoid immediate rematches.
    const drop = [...upper[r]].reverse();
    const nx = cur.map((m, i) => {
      const d = drop[i];
      const nm = mk(winnerOf(state, m), loserOf(state, d), `Winner ${m.id}`, `Loser ${d.id}`);
      m.feeds = nm.id;
      return nm;
    });
    out.push(nx);
    cur = nx;
  }
  return out;
}

export function roundName(i: number, total: number): string {
  const names = ["Final", "Semifinals", "Quarterfinals", "Round of 16", "Round of 32"];
  return names[total - 1 - i] ?? `Round ${i + 1}`;
}

export interface Record_ {
  teamId: string;
  wins: number;
  losses: number;
}

export function swissRecords(state: TournamentState, slots: string[], matches: Match[]): Record_[] {
  return slots
    .map((s) => {
      let wins = 0;
      let losses = 0;
      for (const m of matches) {
        const r = resultOf(state, m);
        if (r && (m.a === s || m.b === s)) {
          if (r.winner === s) wins++;
          else losses++;
        }
      }
      return { teamId: s, wins, losses };
    })
    .sort(
      (x, y) =>
        y.wins - x.wins ||
        x.losses - y.losses ||
        averageScore(state.teams[y.teamId]) - averageScore(state.teams[x.teamId]),
    );
}

/** Group size used by the groups → playoffs format. */
export function groupSize(n: number): number {
  return n >= 8 ? 4 : 2;
}

/**
 * Derive the full bracket from state. This is the single source of truth for
 * which matches exist, who is in them, and who has won.
 */
export function buildBracket(state: TournamentState, format: FormatId = state.format, slots: string[] = state.slots): Bracket {
  const n = slots.length;
  if (n < 2 || (n & (n - 1)) !== 0) {
    throw new Error(`Brackets need a power-of-two number of teams; got ${n}.`);
  }
  const parts: BracketPart[] = [];
  const matches: Match[] = [];
  let champion: string | null = null;
  let byStandings = false;

  if (format === "single") {
    const r = eliminationRounds(state, slots);
    r.forEach((x) => matches.push(...x));
    parts.push({ kind: "bracket", title: "", columns: r.map((ms, i) => ({ title: roundName(i, r.length), matches: ms })) });
    champion = winnerOf(state, r[r.length - 1][0]);
  } else if (format === "double") {
    const ub = eliminationRounds(state, slots);
    const lb = lowerRounds(state, ub);
    const uf = ub[ub.length - 1][0];
    const lf = lb[lb.length - 1][0];
    const gf = makeMatch("GF", winnerOf(state, uf), winnerOf(state, lf), {
      prefix: "GF",
      pa: `Winner ${uf.id}`,
      pb: `Winner ${lf.id}`,
      wave: lb.length + 1,
      depth: ub.length + lb.length,
    });
    uf.feeds = "GF";
    ub.forEach((x) => matches.push(...x));
    lb.forEach((x) => matches.push(...x));
    matches.push(gf);
    parts.push({
      kind: "bracket",
      title: "Upper bracket",
      columns: [
        ...ub.map((ms, i) => ({
          title: i === ub.length - 1 ? "Upper final" : `Upper ${roundName(i, ub.length).toLowerCase()}`,
          matches: ms,
        })),
        { title: "Grand final", matches: [gf] },
      ],
    });
    parts.push({
      kind: "bracket",
      title: "Lower bracket",
      columns: lb.map((ms, i) => ({ title: i === lb.length - 1 ? "Lower final" : `Lower round ${i + 1}`, matches: ms })),
    });
    champion = winnerOf(state, gf);
  } else if (format === "rr") {
    let k = 1;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) matches.push(makeMatch(`R${k++}`, slots[i], slots[j]));
    parts.push({ kind: "cross", title: `Round robin · ${matches.length} matches`, teamIds: slots });
    byStandings = matches.every((m) => resultOf(state, m));
  } else if (format === "swiss") {
    const rounds = Math.max(1, Math.round(Math.log2(n)));
    const columns: Column[] = [];
    const all: Match[] = [];
    const r1: Match[] = [];
    for (let i = 0; i < n / 2; i++) r1.push(makeMatch(`S1-${i + 1}`, slots[2 * i], slots[2 * i + 1], { sa: 2 * i, sb: 2 * i + 1, wave: 0, depth: 0 }));
    columns.push({ title: "Round 1", matches: r1 });
    all.push(...r1);
    let ready = r1.every((m) => resultOf(state, m));
    let built = 1;
    for (let r = 2; r <= rounds; r++) {
      if (!ready) {
        columns.push({ title: `Round ${r}`, matches: [], note: `Pairs teams with the same record once round ${r - 1} is complete. Rematches are avoided.` });
        continue;
      }
      const rec = swissRecords(state, slots, all);
      const played = new Set(all.map((m) => pairKey(m.a as string, m.b as string)));
      const pool = rec.map((x) => x.teamId);
      const pairs: [string, string][] = [];
      while (pool.length > 1) {
        const a = pool.shift() as string;
        let j = pool.findIndex((b) => !played.has(pairKey(a, b)));
        if (j < 0) j = 0;
        pairs.push([a, pool.splice(j, 1)[0]]);
      }
      const ms = pairs.map((p, i) => makeMatch(`S${r}-${i + 1}`, p[0], p[1], { wave: r - 1, depth: 0 }));
      columns.push({ title: `Round ${r}`, matches: ms });
      all.push(...ms);
      built++;
      ready = ms.every((m) => resultOf(state, m));
    }
    matches.push(...all);
    parts.push({ kind: "swiss", title: `Swiss · ${rounds} rounds`, columns });
    parts.push({ kind: "standings", title: "Standings" });
    byStandings = ready && built === rounds;
  } else if (format === "groups") {
    const size = groupSize(n);
    const g = n / size;
    const letters = "ABCDEFGH";
    const groups: { name: string; teamIds: string[]; slotIndexes: number[] }[] = [];
    const qualifiers: (string[] | null)[] = [];
    for (let k = 0; k < g; k++) {
      const idx = Array.from({ length: size }, (_, j) => k * size + j);
      const names = idx.map((i) => slots[i]);
      const gm: Match[] = [];
      let c = 1;
      for (let i = 0; i < size; i++) for (let j = i + 1; j < size; j++) gm.push(makeMatch(`G${letters[k]}${c++}`, names[i], names[j]));
      matches.push(...gm);
      groups.push({ name: `Group ${letters[k]}`, teamIds: names, slotIndexes: idx });
      const gw = (x: string) => gm.filter((m) => winnerOf(state, m) === x).length;
      qualifiers.push(
        gm.every((m) => resultOf(state, m))
          ? [...names].sort((a, b) => gw(b) - gw(a) || averageScore(state.teams[b]) - averageScore(state.teams[a]))
          : null,
      );
    }
    const q = (k: number, place: number) => qualifiers[k]?.[place] ?? null;
    const pair = (ka: number, kb: number): FirstPair => ({ a: q(ka, 0), b: q(kb, 1), pa: `1st Group ${letters[ka]}`, pb: `2nd Group ${letters[kb]}` });
    const fp: FirstPair[] = [];
    if (g === 2) fp.push(pair(0, 1), pair(1, 0));
    else {
      for (let k = 0; k < g; k += 2) fp.push(pair(k, k + 1));
      for (let k = 0; k < g; k += 2) fp.push(pair(k + 1, k));
    }
    const pr = eliminationRounds(state, slots, { idPrefix: "P", keyPrefix: "P", firstPairs: fp, depth0: 1, wave0: 1 });
    pr.forEach((x) => matches.push(...x));
    parts.push({ kind: "groups", title: `Group stage · ${g} groups of ${size}`, groups });
    parts.push({ kind: "bracket", title: "Playoffs", columns: pr.map((ms, i) => ({ title: roundName(i, pr.length), matches: ms })) });
    champion = winnerOf(state, pr[pr.length - 1][0]);
  }

  const base = { format, slots, parts, matches };
  const standings = computeStandings(state, base, champion);
  if (byStandings) champion = standings[0].teamId;
  return { ...base, standings, champion, complete: champion !== null };
}

/** Losses that eliminate a team, by format. */
function lossLimit(format: FormatId): number {
  if (format === "single") return 1;
  if (format === "double") return 2;
  return Infinity;
}

/**
 * Standings: champion first, then teams still alive, then by how deep they
 * got, match wins, fewest losses, and finally average verified rank.
 */
export function computeStandings(
  state: TournamentState,
  b: Pick<Bracket, "format" | "slots" | "matches">,
  champion: string | null,
): Standing[] {
  const limit = lossLimit(b.format);
  const st: Record<string, Standing> = {};
  for (const s of b.slots) st[s] = { teamId: s, wins: 0, losses: 0, reach: 0, alive: true };
  for (const m of b.matches) {
    for (const x of [m.a, m.b]) if (x && st[x]) st[x].reach = Math.max(st[x].reach, m.depth);
    const r = resultOf(state, m);
    if (r && st[r.winner]) {
      const lo = r.winner === m.a ? m.b : m.a;
      st[r.winner].wins++;
      if (lo && st[lo]) st[lo].losses++;
    }
  }
  const arr = Object.values(st);
  for (const x of arr) x.alive = x.losses < limit;
  const avg = (id: string) => averageScore(state.teams[id]);
  arr.sort(
    (x, y) =>
      (champion ? Number(y.teamId === champion) - Number(x.teamId === champion) : 0) ||
      (limit < Infinity ? Number(y.alive) - Number(x.alive) : 0) ||
      y.reach - x.reach ||
      y.wins - x.wins ||
      x.losses - y.losses ||
      avg(y.teamId) - avg(x.teamId),
  );
  return arr;
}

/** Matches ready to play: both teams known, no result yet. */
export function playableMatches(state: TournamentState, b: Bracket): Match[] {
  return b.matches.filter((m) => m.a && m.b && !resultOf(state, m));
}

/**
 * A result can be edited only while no later match involving either team
 * already has a result; otherwise the bracket downstream would be wrong.
 */
export function canReopen(state: TournamentState, b: Bracket, m: Match): boolean {
  if (!resultOf(state, m)) return false;
  return !b.matches.some(
    (x) => x !== m && resultOf(state, x) && x.wave > m.wave && [x.a, x.b].some((v) => v === m.a || v === m.b),
  );
}

export function findMatch(b: Bracket, matchId: string): Match | undefined {
  return b.matches.find((m) => m.id === matchId);
}

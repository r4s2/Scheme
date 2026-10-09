import { averageScore, roleCounts } from "./games";
import type { Player } from "./types";

export type BalanceGoal = "even" | "tiers";

export interface BalancedTeam {
  players: Player[];
  average: number;
}

export interface BalanceResult {
  teams: BalancedTeam[];
  /** Players left over because a role was oversubscribed; they go to the sub list. */
  unplaced: Player[];
  /** Roles that couldn't be filled for every team. */
  shortRoles: { role: string; needed: number; have: number }[];
  /** Gap between the strongest and weakest team, in rank steps. */
  spread: number;
}

/**
 * Build teams from solo sign-ups.
 *
 * Even: a role-by-role snake draft, then same-role swaps that reduce the
 * variance of team averages until no swap helps (a local optimum).
 * Tiers: players are grouped with others near their rank.
 *
 * Deterministic: the same input always produces the same teams, so the agent
 * can explain any placement and hosts can reproduce it.
 */
export function balanceTeams(pool: Player[], teamCount: number, roles: string[], goal: BalanceGoal): BalanceResult {
  if (teamCount < 1) throw new Error("teamCount must be at least 1");
  const counts = roleCounts(roles);
  const teams: Player[][] = Array.from({ length: teamCount }, () => []);
  const unplaced: Player[] = [];
  const shortRoles: BalanceResult["shortRoles"] = [];

  for (const role of Object.keys(counts)) {
    const seats = teamCount * counts[role];
    const all = pool
      .filter((p) => p.role === role)
      .sort((a, b) => b.score - a.score || a.handle.localeCompare(b.handle));
    const list = all.slice(0, seats);
    unplaced.push(...all.slice(seats));
    if (list.length < seats) shortRoles.push({ role, needed: seats, have: list.length });
    if (goal === "tiers") {
      list.forEach((p, i) => teams[Math.floor(i / counts[role])].push(p));
    } else {
      list.forEach((p, i) => {
        const round = Math.floor(i / teamCount);
        const pos = i % teamCount;
        teams[round % 2 ? teamCount - 1 - pos : pos].push(p);
      });
    }
  }

  const avgOf = (t: Player[]) => averageScore({ players: t });
  if (goal === "even") {
    const cost = () => {
      const m = teams.reduce((s, t) => s + avgOf(t), 0) / teams.length;
      return teams.reduce((s, t) => s + (avgOf(t) - m) ** 2, 0);
    };
    for (let pass = 0; pass < 50; pass++) {
      let improved = false;
      for (let i = 0; i < teamCount; i++) {
        for (let j = i + 1; j < teamCount; j++) {
          for (let pi = 0; pi < teams[i].length; pi++) {
            for (let qi = 0; qi < teams[j].length; qi++) {
              const p = teams[i][pi];
              const q = teams[j][qi];
              if (p.role !== q.role || p.score === q.score) continue;
              const before = cost();
              teams[i][pi] = q;
              teams[j][qi] = p;
              if (cost() < before - 1e-9) improved = true;
              else {
                teams[i][pi] = p;
                teams[j][qi] = q;
              }
            }
          }
        }
      }
      if (!improved) break;
    }
  }

  const out = teams.map((players) => ({ players, average: avgOf(players) }));
  if (goal === "tiers") out.sort((a, b) => b.average - a.average);
  const avgs = out.map((t) => t.average);
  return { teams: out, unplaced, shortRoles, spread: Math.max(...avgs) - Math.min(...avgs) };
}

/** Best substitutes for a missing player: same role first, then closest rank. */
export function rankSubs(missing: Pick<Player, "role" | "score">, subs: Player[]): Player[] {
  return [...subs].sort(
    (a, b) =>
      Number(a.role !== missing.role) - Number(b.role !== missing.role) ||
      Math.abs(a.score - missing.score) - Math.abs(b.score - missing.score) ||
      a.handle.localeCompare(b.handle),
  );
}

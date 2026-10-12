import {
  checkCompliance,
  FORMAT_NAMES,
  GAMES,
  OW_6V6_ROLES,
  tierCeiling,
  tierFloor,
  type ComplianceIssue,
  type FormatId,
  type GameId,
} from "@/engine";
import { OperationError, type Ctx, type Outcome, type Profile, type TournamentAgg } from "./model";

/**
 * The "Host a tournament" wizard's draft, and turning it into a published
 * event. The wizard runs draftIssues() as the host types; publishing runs
 * the same checks on the server.
 */

export const REGIONS = ["NA", "NA East", "NA West", "EU", "LATAM", "OCE"];
export const SIZES = [4, 8, 16, 32] as const;

export interface Draft {
  game: GameId;
  name: string;
  format: FormatId;
  bestOf: 1 | 3 | 5;
  teamCount: (typeof SIZES)[number];
  /** Overwatch only: 6v6 instead of 5v5. */
  owSixes: boolean;
  signupType: "team" | "solo";
  balanceGoal: "even" | "tiers";
  /** Rank range as tier indexes into the game's tier list. */
  rankMinTier: number;
  rankMaxTier: number;
  minKarma: number;
  verifiedOnly: boolean;
  region: string;
  /** Start time, ISO. */
  startsAt: string;
  checkinMinutes: number;
  matchWindowHours: number;
  allowExtensions: boolean;
  /** One rule per line. */
  houseRules: string;
  paid: boolean;
  entryFeeDollars: number;
  withholdPct: number;
  split: [number, number, number];
  riotFormAck: boolean;
}

/** A fresh draft: Marvel Rivals, double elimination, eight teams, starting next Saturday at 7 PM Eastern-ish. */
export function newDraft(now: Date): Draft {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() + ((6 - start.getUTCDay() + 7) % 7 || 7));
  start.setUTCHours(23, 0, 0, 0);
  return {
    game: "mr",
    name: "",
    format: "double",
    bestOf: 3,
    teamCount: 8,
    owSixes: false,
    signupType: "solo",
    balanceGoal: "even",
    rankMinTier: 3,
    rankMaxTier: 6,
    minKarma: 60,
    verifiedOnly: true,
    region: "NA",
    startsAt: start.toISOString(),
    checkinMinutes: 60,
    matchWindowHours: 24,
    allowExtensions: true,
    houseRules: "",
    paid: false,
    entryFeeDollars: 20,
    withholdPct: 0,
    split: [60, 30, 10],
    riotFormAck: false,
  };
}

export function draftRoles(d: Pick<Draft, "game" | "owSixes">): string[] {
  return d.game === "ow" && d.owSixes ? OW_6V6_ROLES : GAMES[d.game].roles;
}

/** Everything that blocks or affects publishing: publisher rules, plus schedule and setup checks. */
export function draftIssues(d: Draft, hostKarma: number, now: Date): ComplianceIssue[] {
  const roles = draftRoles(d);
  const issues = checkCompliance({
    game: d.game,
    name: d.name,
    paid: d.paid,
    entryFeeCents: Math.round(d.entryFeeDollars * 100),
    withholdPct: d.withholdPct,
    split: d.split,
    rankMinScore: tierFloor(d.game, d.rankMinTier),
    rankMaxScore: tierCeiling(d.game, d.rankMaxTier),
    participants: d.teamCount * roles.length,
    riotVisibilityFormAcknowledged: d.riotFormAck,
    hostKarma,
  });
  const push = (level: ComplianceIssue["level"], code: string, message: string) => issues.push({ level, code, message });
  const start = Date.parse(d.startsAt);
  if (!Number.isFinite(start)) push("block", "start.invalid", "Pick a start time.");
  else if (start < now.getTime() + 30 * 60_000) push("block", "start.past", "Start at least 30 minutes from now, so players have time to sign up and check in.");
  if (d.name.trim().length > 60) push("block", "name.long", "Keep the name to 60 characters or fewer.");
  if (d.format === "rr" && d.teamCount > 8) push("warn", "format.rr_size", `Round robin with ${d.teamCount} teams is ${(d.teamCount * (d.teamCount - 1)) / 2} matches. Groups → playoffs plays faster.`);
  if (d.paid) push("info", "paid.provider", "Entry fees are collected once Scheme's payment partner is connected. Until then, paid events can be set up but not paid for.");
  return issues;
}

/** Publish a draft: registration opens straight away. */
export function createTournament(d: Draft, ctx: Ctx, host: Profile | undefined): Outcome {
  if (!GAMES[d.game]) throw new OperationError("Pick a game.");
  if (!FORMAT_NAMES[d.format]) throw new OperationError("Pick a format.");
  if (![1, 3, 5].includes(d.bestOf)) throw new OperationError("Series are best of 1, 3 or 5.");
  if (!SIZES.includes(d.teamCount)) throw new OperationError("Brackets hold 4, 8, 16 or 32 teams.");
  const tiers = GAMES[d.game].tiers.length;
  if (!(d.rankMinTier >= 0 && d.rankMaxTier < tiers && d.rankMinTier <= d.rankMaxTier)) throw new OperationError("Pick a rank floor at or below the ceiling.");
  if (!(d.minKarma >= 0 && d.minKarma <= 100)) throw new OperationError("Minimum karma is 0 to 100.");
  if (!REGIONS.includes(d.region)) throw new OperationError("Pick a region.");
  if (![30, 60, 120].includes(d.checkinMinutes)) throw new OperationError("Check-in opens 30, 60 or 120 minutes before the start.");
  if (![12, 24, 48].includes(d.matchWindowHours)) throw new OperationError("Match deadlines are 12, 24 or 48 hours.");
  const blocks = draftIssues(d, host?.hostKarma ?? 70, ctx.now).filter((i) => i.level === "block");
  if (blocks.length) throw new OperationError(blocks[0].message, "conflict");

  const roles = draftRoles(d);
  const name = d.name.trim().replace(/\s+/g, " ");
  const agg: TournamentAgg = {
    id: ctx.newId(),
    version: 1,
    name,
    game: d.game,
    host: ctx.actor,
    status: "registration",
    region: d.region,
    signupType: d.signupType,
    allowExtensions: d.allowExtensions,
    houseRules: d.houseRules.split("\n").map((r) => r.trim()).filter(Boolean).slice(0, 20),
    entryFeeCents: d.paid ? Math.round(d.entryFeeDollars * 100) : 0,
    withholdPct: d.paid ? d.withholdPct : 0,
    payoutSplit: d.paid ? [...d.split] : [60, 30, 10],
    matchWindowHours: d.matchWindowHours,
    startsAt: new Date(d.startsAt).toISOString(),
    teamCount: d.teamCount,
    rankMin: tierFloor(d.game, d.rankMinTier),
    rankMax: tierCeiling(d.game, d.rankMaxTier),
    roles,
    requirements: { minKarma: d.minKarma, verifiedOnly: d.verifiedOnly || d.paid },
    balanceGoal: d.balanceGoal,
    checkinMinutes: d.checkinMinutes,
    state: { format: d.format, bestOf: d.bestOf, slots: [], teams: {}, results: {} },
    schedule: { waveDeadlines: [], overrides: {} },
    subs: [],
    pool: [],
    reports: [],
    disputes: [],
    extensions: [],
    payouts: [],
    announcements: [],
    tickets: [],
  };
  return {
    agg,
    effects: { audit: [{ at: ctx.now.toISOString(), actor: ctx.actor, viaAgent: !!ctx.viaAgent, action: "tournament.create", summary: `Published ${name}: ${FORMAT_NAMES[d.format].toLowerCase()}, ${d.teamCount} teams, ${d.signupType} sign-up.` }], notices: [] },
    message: `${name} is published. Registration is open.`,
  };
}

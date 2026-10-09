import { GAMES } from "./games";
import type { GameId } from "./types";

/**
 * Publisher rules for community events, checked before an event is published
 * and whenever settings change. Rules live here as data so they can be updated
 * when publishers change their policies. Sources are listed in docs/COMPLIANCE.md.
 */

/** Names no community event may use, for any game. */
export const TRADEMARK_TERMS = [
  "riot",
  "riot games",
  "blizzard",
  "netease",
  "activision",
  "overwatch league",
  "owl",
  "vct",
  "champions tour",
  "lcs",
  "lec",
  "worlds",
  "msi",
];

/** NetEase's banned words for Marvel Rivals community event names. */
export const MARVEL_RIVALS_BANNED = ["marvel", "ignite", "final", "finals", "netease", "clash", "official", "cup"];

export const MARVEL_RIVALS_DISCLAIMER = "This event is not endorsed, approved or sponsored by NetEase Games or Marvel.";

/** Riot developer policy: at least this share of entry fees goes to prizes. */
export const RIOT_MIN_PRIZE_SHARE = 0.7;
/** Riot developer policy: minimum participants for tournaments using the API. */
export const RIOT_MIN_PARTICIPANTS = 20;

function wordHits(name: string, terms: string[]): string[] {
  return terms.filter((t) => new RegExp(`(^|[^a-z0-9])${t.replace(/ /g, "\\s+")}([^a-z0-9]|$)`, "i").test(name));
}

/** Words in an event name that the game's publisher doesn't allow. */
export function blockedNameTerms(game: GameId, name: string): string[] {
  const hits = wordHits(name, TRADEMARK_TERMS);
  if (game === "mr") hits.push(...wordHits(name, MARVEL_RIVALS_BANNED).filter((h) => !hits.includes(h)));
  if (game === "ow" && /presented\s+by/i.test(name)) hits.push("presented by");
  return hits;
}

/** Alternative names with the blocked words removed. */
export function suggestNames(name: string, hits: string[]): string[] {
  let base = name;
  for (const h of hits) base = base.replace(new RegExp(h.replace(/ /g, "\\s+"), "ig"), "").replace(/\s{2,}/g, " ").trim();
  if (!base) base = "Friday Night";
  return [...new Set([`${base} Showdown`, `${base} Invitational`, `${base} Social`])];
}

export type IssueLevel = "block" | "warn" | "info" | "ok";

export interface ComplianceIssue {
  level: IssueLevel;
  code: string;
  message: string;
}

export interface EventDraft {
  game: GameId;
  name: string;
  paid: boolean;
  entryFeeCents: number;
  /** Percent of entry fees the host keeps for costs, 0–100. */
  withholdPct: number;
  /** Payout split by place in percent, must sum to 100 when paid. */
  split: number[];
  rankMinScore: number;
  rankMaxScore: number;
  /** Players expected at full capacity. */
  participants: number;
  riotVisibilityFormAcknowledged: boolean;
  hostKarma: number;
}

export const MIN_HOST_KARMA_FOR_PAID = 75;

export function checkCompliance(d: EventDraft): ComplianceIssue[] {
  const out: ComplianceIssue[] = [];
  const pub = GAMES[d.game].publisher;
  const name = d.name.trim();
  const push = (level: IssueLevel, code: string, message: string) => out.push({ level, code, message });

  if (!name) push("block", "name.missing", "Give the event a name.");
  const tm = name ? wordHits(name, TRADEMARK_TERMS) : [];
  if (tm.length) push("block", "name.trademark", `The name uses a publisher trademark (${tm.join(", ")}). Community events can't use it.`);

  if (d.game === "mr") {
    const b = name ? wordHits(name, MARVEL_RIVALS_BANNED) : [];
    if (b.length) push("block", "name.netease", `NetEase doesn't allow "${b.join('", "')}" in community event names.`);
    push("info", "netease.disclaimer", "Scheme adds the required NetEase disclaimer to the event page and Discord posts.");
  }

  if (pub === "blizzard") {
    if (/presented\s+by/i.test(name)) push("block", "name.title_sponsor", 'Overwatch community events can\'t have a "presented by" or title sponsor in the name.');
    if (d.paid && d.withholdPct > 0) push("block", "blizzard.prizes_lt_fees", "Blizzard requires prizes to be at least the entry fees collected. Set the amount held for costs to 0%.");
  }

  if (pub === "riot") {
    if (d.paid && d.withholdPct > (1 - RIOT_MIN_PRIZE_SHARE) * 100) {
      push("block", "riot.prize_share", `Riot requires at least ${RIOT_MIN_PRIZE_SHARE * 100}% of entry fees to go to the prize pool. Hold back ${Math.round((1 - RIOT_MIN_PRIZE_SHARE) * 100)}% or less.`);
    }
    if (d.paid && d.participants < RIOT_MIN_PARTICIPANTS) {
      push("block", "riot.min_participants", `Riot requires at least ${RIOT_MIN_PARTICIPANTS} participants for tournaments with entry fees. This event holds ${d.participants}.`);
    }
    push(
      d.riotVisibilityFormAcknowledged ? "ok" : "warn",
      "riot.visibility_form",
      d.riotVisibilityFormAcknowledged ? "You'll submit Riot's event visibility form." : "Riot asks hosts to register community events through its visibility form.",
    );
  }

  if (d.paid) {
    const sum = d.split.reduce((a, b) => a + b, 0);
    if (sum !== 100) push("block", "split.sum", `Payout split adds up to ${sum}%. It needs to add up to 100%.`);
    if (d.split.some((p) => p < 0)) push("block", "split.negative", "Payout percentages can't be negative.");
    if (d.entryFeeCents <= 0) push("block", "fee.missing", "Set an entry fee, or switch to free entry.");
    if (d.hostKarma < MIN_HOST_KARMA_FOR_PAID) push("block", "host.karma", `Paid events need host karma of ${MIN_HOST_KARMA_FOR_PAID} or identity verification. Yours is ${d.hostKarma}.`);
    push("info", "paid.eligibility", "Paid entry is limited to players 18 and over and blocked in restricted states. Payouts release after the dispute window.");
  }

  if (d.rankMinScore > d.rankMaxScore) push("block", "rank.range", "The rank floor is above the rank ceiling.");
  if (name && !out.some((x) => x.level === "block" && x.code.startsWith("name."))) {
    out.unshift({ level: "ok", code: "name.ok", message: "Event name passes every publisher check." });
  }
  return out;
}

export function hasBlockingIssues(issues: ComplianceIssue[]): boolean {
  return issues.some((i) => i.level === "block");
}

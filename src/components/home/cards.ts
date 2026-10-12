import { FORMAT_NAMES, rankName } from "@/engine";
import { dollars, startText } from "@/lib/format";
import type { TournamentSummary } from "@/server/store";
import type { Card } from "./types";

/** Turn store summaries into ready-to-render cards (server side, so times read the same everywhere). */
export function toCards(list: TournamentSummary[], now: Date): Card[] {
  return list
    .filter((t): t is TournamentSummary & { status: Card["status"] } => t.status !== "draft")
    .map((t) => ({
      id: t.id,
      name: t.name,
      game: t.game,
      format: t.format,
      formatName: FORMAT_NAMES[t.format],
      signupType: t.signupType,
      status: t.status,
      entryFeeCents: t.entryFeeCents,
      entryText: `${dollars(t.entryFeeCents)} / ${t.signupType === "solo" ? "player" : "team"} entry`,
      registered: t.registered,
      capacity: t.signupType === "solo" ? t.teamCount * t.teamSize : t.teamCount,
      unit: t.signupType === "solo" ? "players" : "teams",
      startText: t.status === "live" ? "Live now" : t.status === "checkin" ? `Check-in open · ${startText(t.startsAt, now)}` : startText(t.startsAt, now),
      rankText: `${rankName(t.game, t.rankMin)} – ${rankName(t.game, t.rankMax)}`,
      host: t.host,
      hostKarma: t.hostKarma,
      region: t.region,
      winners: t.winners,
    }));
}

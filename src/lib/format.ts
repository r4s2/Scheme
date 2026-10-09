import { formatCents, type MatchStatus } from "@/engine";

export const DEFAULT_TZ = "America/New_York";

export function formatWhen(d: Date | string, tz = DEFAULT_TZ): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

export function hoursText(h: number): string {
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function statusText(s: MatchStatus): string {
  switch (s.kind) {
    case "final":
      return "Final";
    case "forfeit":
      return "Forfeit";
    case "waiting":
      return "Waiting";
    case "scheduled":
      return "Scheduled";
    case "disputed":
      return "Disputed";
    case "awaiting_confirm":
      return "Awaiting confirm";
    case "due":
      return `Due in ${hoursText(s.hoursLeft)}`;
    case "overdue":
      return `${hoursText(s.hoursOver)} overdue`;
  }
}

/** "Hot Coffee's", "Backline Bandits'". */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

export { formatCents };

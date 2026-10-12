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

/**
 * Friendly start time for listings, in Eastern time like the prototype:
 * "Tonight, 9:00 PM ET", "Sat, 8:00 PM ET", "Next Wed, 7:00 PM ET",
 * "Live now", or a date for anything further out or in the past.
 */
export function startText(startsAt: string, now: Date, tz = DEFAULT_TZ): string {
  const start = new Date(startsAt);
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });
  const time = start.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const days = Math.round((Date.parse(day(start)) - Date.parse(day(now))) / 86_400_000);
  const weekday = start.toLocaleDateString("en-US", { timeZone: tz, weekday: "short" });
  if (days === 0) return `${Number(start.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", hour12: false })) >= 17 ? "Tonight" : "Today"}, ${time} ET`;
  if (days === 1) return `Tomorrow, ${time} ET`;
  if (days === -1) return `Yesterday, ${time} ET`;
  if (days > 1 && days < 7) return `${weekday}, ${time} ET`;
  if (days >= 7 && days < 14) return `Next ${weekday}, ${time} ET`;
  return `${start.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" })}, ${time} ET`;
}

/** "$30" or "$12.50". */
export function dollars(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

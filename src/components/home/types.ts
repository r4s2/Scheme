import type { FormatId, GameId } from "@/engine";

/** A tournament card, ready to render. Built on the server so times and ranks read the same everywhere. */
export interface Card {
  id: string;
  name: string;
  game: GameId;
  format: FormatId;
  formatName: string;
  signupType: "team" | "solo";
  status: "registration" | "checkin" | "live" | "complete" | "cancelled";
  winners: string[];
  entryFeeCents: number;
  entryText: string;
  registered: number;
  capacity: number;
  unit: "teams" | "players";
  startText: string;
  rankText: string;
  /** Rank range as ladder scores; with rankRule "open" there's no range. */
  rankMin: number;
  rankMax: number;
  rankRule: "open" | "suggested" | "required";
  host: string;
  hostKarma: number;
  region: string;
}

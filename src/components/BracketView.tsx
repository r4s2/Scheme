import type { GameId, TournamentState } from "@/engine";
import { BracketBoard } from "./bracket/BracketBoard";

/** Read-only bracket for any engine state (used by /demo). Tournament pages use BracketBoard with boardProps. */
export function BracketView({ state, game }: { state: TournamentState; game: GameId }) {
  return <BracketBoard state={state} game={game} />;
}

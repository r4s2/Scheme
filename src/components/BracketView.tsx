import type { GameId, TournamentState } from "@/engine";
import { Board } from "./bracket/Board";

/** Read-only bracket for any engine state (used by /demo). Tournament pages use Board directly. */
export function BracketView({ state, game }: { state: TournamentState; game: GameId }) {
  return <Board state={state} game={game} />;
}

import { GAMES, type GameId } from "@/engine";

export const GAME_COLOR: Record<GameId, string> = { val: "var(--g-val)", mr: "var(--g-mr)", ow: "var(--g-ow)", lol: "var(--g-lol)" };

export function GameDot({ game }: { game: GameId }) {
  return <span className="gdot" style={{ background: GAME_COLOR[game] }} aria-hidden="true" />;
}

export function GameBadge({ game }: { game: GameId }) {
  return (
    <span className="gbadge">
      <GameDot game={game} />
      {GAMES[game].name}
    </span>
  );
}

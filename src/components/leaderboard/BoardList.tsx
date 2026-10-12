import { TrophyIcon } from "@/components/ui/icons";
import type { BoardRow } from "@/server/summary";

/** Ranked rows: position, name with detail, and tournaments won. Ties share a position. */
export function BoardList({ rows, limit, players = false }: { rows: BoardRow[]; limit?: number; players?: boolean }) {
  const shown = rows.slice(0, limit ?? rows.length);
  return (
    <ol className="lb">
      {shown.map((r) => {
        const pos = rows.findIndex((x) => x.wins === r.wins) + 1;
        return (
          <li key={`${r.name}-${r.detail}`}>
            <span className="pos">{pos}</span>
            <span className="who">
              <b>
                {players ? (
                  <a href={`/u/${encodeURIComponent(r.name)}`} style={{ color: "inherit" }}>
                    {r.name}
                  </a>
                ) : (
                  r.name
                )}
              </b>
              <span>{r.detail}</span>
            </span>
            <span className="wins" aria-label={`${r.wins} tournament${r.wins === 1 ? "" : "s"} won`}>
              <TrophyIcon />
              {r.wins}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

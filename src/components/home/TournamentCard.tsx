import Link from "next/link";
import { GameBadge } from "@/components/ui/bits";
import type { Card } from "./types";

export function TournamentCard({ c }: { c: Card }) {
  const full = c.registered >= c.capacity;
  const pct = Math.min(100, (c.registered / Math.max(1, c.capacity)) * 100);
  return (
    <Link href={`/t/${c.id}`} className="card tcard">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <GameBadge game={c.game} />
        {c.status === "complete" ? (
          <span className="pill gold">Closed</span>
        ) : c.status === "cancelled" ? (
          <span className="pill quiet">Cancelled</span>
        ) : c.status === "live" ? (
          <span className="pill bad">Live</span>
        ) : c.status === "checkin" ? (
          <span className="pill warn">Check-in open</span>
        ) : c.entryFeeCents ? (
          <span className="pill info">{c.entryText}</span>
        ) : (
          <span className="pill good">Free</span>
        )}
      </div>
      <h3>{c.name}</h3>
      <dl className="meta">
        <dt>Format</dt>
        <dd>{c.formatName}</dd>
        <dt>Sign-up</dt>
        <dd>{c.signupType === "solo" ? "Solo · teams balanced by Scheme" : "Teams"}</dd>
        <dt>Ranks</dt>
        <dd>{c.rankText}</dd>
        <dt>Starts</dt>
        <dd>{c.startText}</dd>
      </dl>
      {c.status === "complete" ? (
        <p className="small">
          <span className="muted">Won by </span>
          <b>{c.winners.join(" & ") || "—"}</b>
        </p>
      ) : c.status === "cancelled" ? null : (
      <div>
        <div className="row tiny muted" style={{ justifyContent: "space-between", marginBottom: 4 }}>
          <span>
            {c.registered} of {c.capacity} {c.unit}
          </span>
          <span>{full ? "Full" : `${c.capacity - c.registered} spots left`}</span>
        </div>
        <div className="fill" role="presentation">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
      )}
      <div className="tcard-foot">
        <span className="muted">
          Host <b style={{ color: "var(--ink)" }}>{c.host}</b>
        </span>
        <span className="mono tiny">Host karma {c.hostKarma}</span>
      </div>
    </Link>
  );
}

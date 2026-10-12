import Link from "next/link";
import { notFound } from "next/navigation";
import { GAMES, rankName } from "@/engine";
import { toCards } from "@/components/home/cards";
import { TournamentCard } from "@/components/home/TournamentCard";
import { GameBadge } from "@/components/ui/bits";
import { CheckIcon, TrophyIcon, WarnIcon } from "@/components/ui/icons";
import { formatWhen } from "@/lib/format";
import { listTournaments } from "@/server/data";
import { getStore } from "@/server/store";
import { currentActor } from "@/server/session";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  return { title: `${decodeURIComponent((await params).handle)} · Scheme` };
}

/** A player's profile: karma, linked game accounts and ranks, saved teams, wins and events. */
export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const handle = decodeURIComponent((await params).handle);
  const store = getStore();
  const [[profile], actor] = await Promise.all([store.profiles([handle]), currentActor()]);
  if (!profile) notFound();
  const [rosters, wins, list] = await Promise.all([store.rosters(profile.handle), store.wins(), listTournaments()]);
  const me = actor?.toLowerCase() === profile.handle.toLowerCase();
  const myWins = wins.filter((w) => w.players.some((p) => p.toLowerCase() === profile.handle.toLowerCase())).sort((a, b) => b.at.localeCompare(a.at));
  const events = list.filter((t) => t.players.includes(profile.handle) || t.host === profile.handle);
  const active = events.filter((t) => t.status !== "complete" && t.status !== "cancelled");
  const hosted = events.filter((t) => t.host === profile.handle).length;
  const nameOf = (id: string) => list.find((t) => t.id === id)?.name ?? "A tournament";

  return (
    <main>
      <div className="prof-head">
        <span className="avatar" aria-hidden="true">
          {profile.handle[0].toUpperCase()}
        </span>
        <div>
          <h1>{profile.handle}</h1>
          <p className="muted small">
            {events.length - hosted} event{events.length - hosted === 1 ? "" : "s"} played · {hosted} hosted · {myWins.length} won
          </p>
        </div>
      </div>

      <div className="karma">
        <div className="card">
          <div className="label">Player karma</div>
          <div className="score">
            {profile.playerKarma}
            <small> / 100</small>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>
            Moves with show-ups, on-time results, opponent ratings and disputes.
          </p>
        </div>
        <div className="card">
          <div className="label">Host karma</div>
          <div className="score">
            {profile.hostKarma}
            <small> / 100</small>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>
            Moves with events that start on time, fair rulings and payouts made on time.
          </p>
        </div>
      </div>

      <div className="section-h">
        <h2>Game pool</h2>
        {me && <span className="small muted">Linking more games arrives with sign-in (Riot Sign On, Battle.net).</span>}
      </div>
      {profile.accounts.length === 0 ? (
        <div className="empty">No linked game accounts yet.</div>
      ) : (
        <div className="pool">
          {profile.accounts.map((a) => (
            <div key={a.game} className="card gcard">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <GameBadge game={a.game} />
                {a.source === "api" ? (
                  <span className="pill good">
                    <CheckIcon />
                    Verified
                  </span>
                ) : (
                  <span className="pill warn">
                    <WarnIcon />
                    Self-reported
                  </span>
                )}
              </div>
              <div className="rank">{rankName(a.game, a.rankScore)}</div>
              <dl className="kv">
                <dt>Account</dt>
                <dd className="mono">{a.accountName}</dd>
                <dt>Roles</dt>
                <dd>{a.roles.join(", ") || "—"}</dd>
                <dt>Source</dt>
                <dd>{GAMES[a.game].rankSource}</dd>
              </dl>
            </div>
          ))}
        </div>
      )}

      <div className="section-h">
        <h2>Wins</h2>
        <span className="small muted">{myWins.length}</span>
      </div>
      {myWins.length === 0 ? (
        <div className="empty">No tournament wins yet.</div>
      ) : (
        <div className="card list">
          {myWins.slice(0, 12).map((w) => (
            <Link key={`${w.tournamentId}-${w.team}`} href={`/t/${w.tournamentId}`} className="litem" style={{ color: "inherit", textDecoration: "none" }}>
              <b>
                <TrophyIcon style={{ width: 14, height: 14, color: "var(--gold)", verticalAlign: -2 }} /> {nameOf(w.tournamentId)} · {w.team}
              </b>
              <GameBadge game={w.game} />
              <span className="sub">1st place · {formatWhen(w.at)}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="section-h">
        <h2>Teams</h2>
        {me && <Link href="/teams" className="btn sm">Manage teams</Link>}
      </div>
      {rosters.length === 0 ? (
        <div className="empty">Not on any saved teams.</div>
      ) : (
        <div className="row">
          {rosters.map((r) => (
            <span key={r.id} className="gbadge" style={{ padding: "6px 10px", fontSize: 13 }}>
              {r.name} · {GAMES[r.game].name}
              {r.captain === profile.handle ? " · captain" : ""}
            </span>
          ))}
        </div>
      )}

      <div className="section-h">
        <h2>Current events</h2>
        <span className="small muted">{active.length}</span>
      </div>
      {active.length === 0 ? (
        <div className="empty">Nothing right now.</div>
      ) : (
        <div className="lib-grid">
          {toCards(active, new Date()).map((c) => (
            <TournamentCard key={c.id} c={c} />
          ))}
        </div>
      )}
    </main>
  );
}

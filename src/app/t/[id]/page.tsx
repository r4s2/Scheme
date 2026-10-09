import Link from "next/link";
import { notFound } from "next/navigation";
import { FORMAT_NAMES, GAMES } from "@/engine";
import { BracketView } from "@/components/BracketView";
import ui from "@/components/ui.module.css";
import { Checkin } from "@/components/tournament/Checkin";
import { ClosePanel } from "@/components/tournament/ClosePanel";
import { Desk } from "@/components/tournament/Desk";
import { FinalResults } from "@/components/tournament/FinalResults";
import { HostBracket } from "@/components/tournament/HostBracket";
import { PlayerMatch } from "@/components/tournament/PlayerMatch";
import { formatWhen } from "@/lib/format";
import { runDueJobs, teamOf } from "@/server/operations";
import { ConflictError, getStore } from "@/server/store";
import { currentActor } from "@/server/session";
import { deskItems } from "@/server/views";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  draft: "Draft",
  registration: "Registration open",
  checkin: "Check-in open",
  live: "Live",
  complete: "Closed",
  cancelled: "Cancelled",
};

export default async function TournamentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; msg?: string; err?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const store = getStore();
  let agg = await store.get(id);
  if (!agg) notFound();

  // Until the background worker exists, due jobs (auto-confirm, payout release) run on view.
  const now = new Date();
  const jobs = runDueJobs(agg, now);
  if (jobs) {
    try {
      agg = await store.commit(agg, jobs);
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      agg = (await store.get(id))!;
    }
  }

  const actor = await currentActor();
  const isHost = actor === agg.host;
  const onTeam = actor ? teamOf(agg, actor) : null;
  const open = agg.status !== "complete" && agg.status !== "cancelled";
  const desk = deskItems(agg, now);

  const tabs: [string, string, number?][] = isHost
    ? [
        ["bracket", "Bracket"],
        ["desk", "Match desk", desk.count],
        ...(agg.status === "registration" || agg.status === "checkin" ? ([["checkin", "Check-in"]] as [string, string][]) : []),
        ...(open ? ([["close", "Close"]] as [string, string][]) : []),
        ["log", "Change log"],
      ]
    : onTeam
      ? [
          ["match", "My match"],
          ["bracket", "Bracket"],
        ]
      : [["bracket", "Bracket"]];
  const tab = tabs.some((t) => t[0] === sp.tab) ? sp.tab! : tabs[0][0];
  const log = tab === "log" ? await store.auditLog(id) : [];

  return (
    <main className={ui.page}>
      <div className={ui.crumbs}>
        <Link href="/">Tournaments</Link> / {agg.name}
      </div>
      <div className={ui.head}>
        <div>
          <h1 className={ui.title}>{agg.name}</h1>
          <div className={ui.meta}>
            <span className={ui.pill}>{GAMES[agg.game].name}</span>
            <span className={`${ui.pill} ${agg.status === "live" ? ui.pillBad : agg.status === "complete" ? ui.pillGood : ui.pillInfo}`}>{STATUS[agg.status]}</span>
            <span>
              {FORMAT_NAMES[agg.state.format]} · Bo{agg.state.bestOf} · {agg.signupType === "solo" ? "Solo sign-up" : "Team sign-up"} · {agg.region}
            </span>
            <span>· Hosted by {agg.host}</span>
          </div>
        </div>
        <p className={`${ui.small} ${ui.muted}`}>
          {actor ? (isHost ? "You're the host." : onTeam ? `You play for ${agg.state.teams[onTeam].name}.` : "You're following this event.") : "Read only."}
        </p>
      </div>

      {sp.msg && <div data-flash="ok" className={`${ui.flash} ${ui.flashOk}`} role="status">{sp.msg}</div>}
      {sp.err && <div data-flash="err" className={`${ui.flash} ${ui.flashErr}`} role="alert">{sp.err}</div>}

      <nav className={ui.tabs} aria-label="Sections">
        {tabs.map(([key, label, n]) => (
          <Link key={key} href={`/t/${id}?tab=${key}`} className={`${ui.tab} ${key === tab ? ui.tabActive : ""}`} aria-current={key === tab ? "page" : undefined}>
            {label}
            {n ? <span className={ui.count}>{n}</span> : null}
          </Link>
        ))}
      </nav>

      {tab === "bracket" && (
        <>
          <FinalResults agg={agg} />
          {isHost ? <HostBracket agg={agg} now={now} editable={open} /> : <BracketView state={agg.state} game={agg.game} />}
        </>
      )}
      {tab === "desk" && <Desk agg={agg} now={now} />}
      {tab === "checkin" && <Checkin agg={agg} />}
      {tab === "close" && <ClosePanel agg={agg} />}
      {tab === "match" && actor && (
        <>
          <FinalResults agg={agg} />
          <PlayerMatch agg={agg} actor={actor} now={now} />
        </>
      )}
      {tab === "log" && (
        <div className={ui.card}>
          <p className={ui.lead}>Every change to the bracket, schedule and results since this server started, with who made it.</p>
          {log.length === 0 ? (
            <p className={ui.muted}>No changes yet.</p>
          ) : (
            <ul className={ui.log}>
              {[...log].reverse().map((e, i) => (
                <li key={i}>
                  <span className={`${ui.small} ${ui.muted}`}>
                    {formatWhen(e.at)}
                    <br />
                    {e.actor}
                    {e.viaAgent ? " via Scheme Agent" : ""}
                  </span>
                  <span>{e.summary}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}

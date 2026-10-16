import Link from "next/link";
import { notFound } from "next/navigation";
import { FORMAT_NAMES, formatCents, rankName } from "@/engine";
import { BracketBoard } from "@/components/bracket/BracketBoard";
import { boardProps } from "@/components/bracket/props";
import { GameBadge } from "@/components/ui/bits";
import { Checkin } from "@/components/tournament/Checkin";
import { ClosePanel } from "@/components/tournament/ClosePanel";
import { Desk } from "@/components/tournament/Desk";
import { FinalResults } from "@/components/tournament/FinalResults";
import { HostBracket } from "@/components/tournament/HostBracket";
import { PlayerMatch } from "@/components/tournament/PlayerMatch";
import { Announcements, Tickets } from "@/components/tournament/Community";
import { Registration, type SignupContext } from "@/components/tournament/Registration";
import { Rosters } from "@/components/tournament/Rosters";
import { Hidden, Op } from "@/components/tournament/Op";
import { FieldBreakdown, StatStrip, Stats } from "@/components/tournament/Stats";
import { DeskHub, deskHubCount } from "@/components/tournament/DeskHub";
import { LAYOUT } from "@/config/layout";
import { Tabs } from "@/components/tournament/Tabs";
import { WinnerPopup } from "@/components/tournament/WinnerPopup";
import { dollars, formatWhen } from "@/lib/format";
import { teamWins } from "@/server/data";
import type { TournamentAgg } from "@/server/model";
import { fullRoster, ineligibility, rankNote } from "@/server/registration";
import { rosterTeamOf, runDueJobs, teamOf } from "@/server/operations";
import { ConflictError, DatabaseUnavailableError, getStore } from "@/server/store";
import { currentActor } from "@/server/session";
import { deskItems } from "@/server/views";

export const dynamic = "force-dynamic";


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
      if (!(e instanceof ConflictError) && !(e instanceof DatabaseUnavailableError)) throw e;
      const fresh = await store.get(id);
      if (!fresh) notFound();
      agg = fresh;
    }
  }

  const actor = await currentActor();
  const isHost = actor === agg.host;
  const onTeam = actor ? teamOf(agg, actor) : null;
  const open = agg.status !== "complete" && agg.status !== "cancelled";
  const registering = agg.status === "registration";
  // Layout experiments (src/config/layout.ts): each can be switched off on its own.
  const hubDesk = isHost && LAYOUT.deskHub;
  const hubBracket = LAYOUT.bracketHub;
  const deskCount = hubDesk ? deskHubCount(agg, now) : registering ? 0 : deskItems(agg, now).count;

  type Tab = [key: string, label: string, count?: number];
  const rosterTeam = actor ? rosterTeamOf(agg, actor) : null;
  const inEvent = !!actor && (!!rosterTeam || agg.subs.some((p) => p.handle === actor) || agg.pool.some((p) => p.handle === actor));
  const openTickets = agg.tickets.filter((k) => k.status === "open" && (isHost || k.openedBy === actor)).length;
  const hasTeams = Object.keys(agg.state.teams).length > 0;
  const tabs: Tab[] = [];
  if (registering) {
    tabs.push(["bracket", "Registration"]);
    if (hubDesk) tabs.push(["desk", "Match desk", deskCount]);
  } else {
    if (onTeam && !isHost) tabs.push(["match", "My match"]);
    tabs.push(["bracket", "Bracket"]);
    if (isHost) tabs.push(["desk", "Match desk", deskCount]);
    if (isHost && agg.status === "checkin") tabs.push(["checkin", "Check-in"]);
  }
  if (hasTeams) tabs.push(["teams", "Teams"]);
  if (hasTeams && !hubBracket) tabs.push(["stats", "Stats"]);
  if (!hubDesk) tabs.push(["announce", "Announcements"]);
  if ((isHost && !hubDesk) || (!isHost && inEvent)) tabs.push(["tickets", "Tickets", openTickets]);
  if (isHost && open && !registering && !hubDesk) tabs.push(["close", "Close"]);
  if (isHost) tabs.push(["log", "Change log"]);
  // Older links (notifications, bookmarks) to tabs that moved land where their content now lives.
  const moved: Record<string, string> = { rosters: "teams", ...(hubBracket ? { stats: "bracket" } : {}), ...(hubDesk ? { announce: "desk", tickets: "desk", close: "desk" } : {}) };
  const asked = sp.tab ? (moved[sp.tab] ?? sp.tab) : undefined;
  const tab = tabs.some((t) => t[0] === asked) ? asked! : tabs[0][0];

  // Everything the tabs need, fetched together so switching tabs needs no further round trips.
  const [wins, signup, log] = await Promise.all([
    teamWins(agg.game),
    registering && actor && !isHost ? signupContext(agg, actor) : Promise.resolve<SignupContext>({ actor, rosters: [], soloBlocker: null, soloNote: null }),
    isHost ? store.auditLog(id) : Promise.resolve([]),
  ]);
  const pill: Record<string, [string, string]> = {
    draft: ["quiet", "Draft"],
    registration: ["info", "Registration open"],
    checkin: ["warn", "Check-in"],
    live: ["bad", "Live"],
    complete: ["gold", "Closed"],
    cancelled: ["quiet", "Cancelled"],
  };
  const myTeam = onTeam ? agg.state.teams[onTeam] : null;
  const benchTeam = !onTeam && rosterTeam ? agg.state.teams[rosterTeam] : null;
  // The viewer's answer to the captain who listed them, if they haven't confirmed.
  const rosterTeamObj = rosterTeam ? agg.state.teams[rosterTeam] : null;
  const mySpot = rosterTeamObj && actor ? fullRoster(rosterTeamObj).find((p) => p.handle === actor) : undefined;
  const asSub = !!rosterTeamObj?.bench?.some((p) => p.handle === actor);
  const askAnswer = (registering || agg.status === "checkin") && mySpot?.confirmation ? mySpot.confirmation : null;
  const won = !!onTeam && agg.status === "complete" && !!agg.closure?.places[0]?.includes(onTeam);
  const myPrize = agg.payouts.filter((p) => p.handle === actor).reduce((n, p) => n + p.cents, 0);

  return (
    <main>
      <div className="crumbs">
        <Link href="/" style={{ color: "inherit" }}>
          Browse
        </Link>{" "}
        / {agg.name}
      </div>
      <div className="thead">
        <div>
          <h1>{agg.name}</h1>
          <div className="metaline">
            <GameBadge game={agg.game} />
            <span className={`pill ${pill[agg.status][0]}`}>{pill[agg.status][1]}</span>
            <span>
              {FORMAT_NAMES[agg.state.format]} · Bo{agg.state.bestOf} · {agg.signupType === "solo" ? "Solo sign-up" : "Team sign-up"} · {agg.region}
              {agg.entryFeeCents ? ` · ${dollars(agg.entryFeeCents)} entry` : " · Free"}
            </span>
            <span>· Hosted by {agg.host}</span>
          </div>
        </div>
        <p className="small muted" style={{ maxWidth: 320 }}>
          {actor ? (isHost ? "You're the host." : myTeam ? `You play for ${myTeam.name}.` : benchTeam ? `You're a sub for ${benchTeam.name}.` : "You're following this event.") : "Read only."}
        </p>
      </div>

      {sp.msg && (
        <div data-flash="ok" className="banner info" role="status">
          <div className="btext">{sp.msg}</div>
        </div>
      )}
      {sp.err && (
        <div data-flash="err" className="banner bad" role="alert">
          <div className="btext">{sp.err}</div>
        </div>
      )}

      {askAnswer && rosterTeamObj && mySpot && (
        <div className={`banner ${askAnswer === "declined" ? "bad" : "info"}`} role="status">
          <div className="btext">
            {askAnswer === "pending" ? (
              <>
                <b>
                  {rosterTeamObj.captain} added you to {rosterTeamObj.name} {asSub ? "as a sub" : "as a starter"} ({mySpot.role}).
                </b>
                <span className="small">Confirm you&apos;re playing so your captain knows the roster is set.</span>
              </>
            ) : (
              <>
                <b>You told {rosterTeamObj.captain} you can&apos;t play for {rosterTeamObj.name}.</b>
                <span className="small">Changed your mind? Confirm until your captain replaces you.</span>
              </>
            )}
          </div>
          <div className="row">
            <Op tid={agg.id} op="confirmSpot">
              <Hidden name="answer" value="yes" />
              <button className="btn sm primary">I&apos;m playing</button>
            </Op>
            {askAnswer === "pending" && (
              <Op tid={agg.id} op="confirmSpot">
                <Hidden name="answer" value="no" />
                <button className="btn sm">Can&apos;t play</button>
              </Op>
            )}
          </div>
        </div>
      )}

      <Tabs
        tabs={tabs.map(([key, label, count]) => ({ key, label, count }))}
        initial={tab}
        panels={{
          bracket:
            agg.status === "registration" ? (
              <Registration agg={agg} now={now} isHost={isHost} wins={wins} signup={signup} />
            ) : (
              <>
                {hubBracket && <StatStrip agg={agg} />}
                <FinalResults agg={agg} />
                {isHost ? <HostBracket agg={agg} now={now} editable={open} wins={wins} /> : <BracketBoard {...boardProps(agg, now, { mine: onTeam, wins })} />}
                {hubBracket && <FieldBreakdown agg={agg} folded />}
              </>
            ),
          desk: hubDesk ? <DeskHub agg={agg} now={now} /> : isHost && !registering ? <Desk agg={agg} now={now} /> : null,
          teams: hasTeams ? <Rosters agg={agg} /> : null,
          stats: hasTeams && !hubBracket ? <Stats agg={agg} /> : null,
          announce: hubDesk ? null : <Announcements agg={agg} isHost={isHost} />,
          tickets: (isHost && !hubDesk) || (!isHost && inEvent) ? <Tickets agg={agg} actor={actor} isHost={isHost} /> : null,
          checkin: isHost && agg.status === "checkin" ? <Checkin agg={agg} /> : null,
          close: isHost && open && !registering && !hubDesk ? <ClosePanel agg={agg} /> : null,
          match:
            actor && onTeam && !isHost && !registering ? (
              <>
                <FinalResults agg={agg} />
                <PlayerMatch agg={agg} actor={actor} now={now} />
              </>
            ) : null,
          log: isHost ? (
            <div className="card panel">
              <p className="lead">Every change to the bracket, schedule and results, with who made it.</p>
              {log.length === 0 ? (
                <p className="muted">No changes yet.</p>
              ) : (
                <ul className="log">
                  {[...log].reverse().map((e, i) => (
                    <li key={i}>
                      <span className="small muted">
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
          ) : null,
        }}
      />
      {won && myTeam && (
        <WinnerPopup
          id={`${agg.id}:${actor}`}
          team={myTeam.name}
          tournament={agg.name}
          prize={myPrize ? formatCents(myPrize) : agg.closure?.prize?.name ?? null}
          message={agg.closure?.message ?? ""}
          href={`/t/${id}?tab=match`}
        />
      )}
    </main>
  );
}

/** What the viewer needs to sign up: their saved teams for this game (with each member checked) or their own eligibility. */
async function signupContext(agg: TournamentAgg, actor: string): Promise<SignupContext> {
  const store = getStore();
  if (agg.signupType === "solo") {
    const [me] = await store.profiles([actor]);
    return { actor, rosters: [], soloBlocker: ineligibility(agg, me, actor), soloNote: rankNote(agg, me) };
  }
  const mine = (await store.rosters(actor)).filter((r) => r.game === agg.game && r.captain === actor);
  const handles = [...new Set(mine.flatMap((r) => r.members.filter((m) => m.status === "active").map((m) => m.handle)))];
  const profiles = await store.profiles(handles);
  const byHandle = new Map(profiles.map((p) => [p.handle.toLowerCase(), p]));
  return {
    actor,
    soloBlocker: null,
    soloNote: null,
    rosters: mine.map((r) => ({
      id: r.id,
      name: r.name,
      members: r.members
        .filter((m) => m.status === "active")
        .map((m) => {
          const p = byHandle.get(m.handle.toLowerCase());
          const acct = p?.accounts.find((a) => a.game === agg.game);
          return { handle: m.handle, role: m.role, rank: acct ? rankName(agg.game, acct.rankScore) : "—", blocker: ineligibility(agg, p, m.handle), note: rankNote(agg, p) };
        }),
    })),
  };
}

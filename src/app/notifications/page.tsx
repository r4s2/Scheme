import Link from "next/link";
import { markNotificationsRead } from "@/app/actions";
import ui from "@/components/ui.module.css";
import { formatWhen } from "@/lib/format";
import { getStore } from "@/server/store";
import { currentActor } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function Notifications() {
  const actor = await currentActor();
  if (!actor) {
    return (
      <main className={ui.page}>
        <p className={ui.muted}>Sign in to see notifications.</p>
      </main>
    );
  }
  const list = await getStore().notifications(actor);
  return (
    <main className={ui.page}>
      <div className={ui.head}>
        <h1 className={ui.title}>Notifications</h1>
        {list.some((n) => !n.read) && (
          <form action={markNotificationsRead}>
            <button className={ui.btn}>Mark all read</button>
          </form>
        )}
      </div>
      <div className={ui.card}>
        {list.length === 0 ? (
          <p className={ui.muted}>Nothing yet. Notices about your matches, results and prizes show up here.</p>
        ) : (
          <ul className={ui.log}>
            {list.map((n) => (
              <li key={n.id}>
                <span className={`${ui.small} ${ui.muted}`}>
                  {formatWhen(n.createdAt)}
                  {!n.read && (
                    <>
                      {" "}
                      <span className={`${ui.pill} ${ui.pillInfo}`}>New</span>
                    </>
                  )}
                </span>
                <span>
                  {n.body}{" "}
                  {n.link && (
                    <Link href={n.link} className={ui.small}>
                      Open
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

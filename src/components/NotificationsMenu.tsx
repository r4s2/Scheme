"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { markNotificationsRead } from "@/app/actions";
import { BellIcon } from "./ui/icons";

export interface MenuNotice {
  id: string;
  body: string;
  link: string;
  when: string;
  read: boolean;
}

/** The bell in the top bar and its dropdown, as in the prototype. */
export function NotificationsMenu({ notices }: { notices: MenuNotice[] }) {
  const [open, setOpen] = useState(false);
  const [allRead, setAllRead] = useState(false);
  const [, start] = useTransition();
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const shown = allRead ? notices.map((n) => ({ ...n, read: true })) : notices;
  const unread = shown.filter((n) => !n.read).length;

  // New notices from the server replace the optimistic "all read".
  useEffect(() => setAllRead(false), [notices]);

  const markRead = () => {
    setAllRead(true);
    start(async () => {
      await markNotificationsRead();
      router.refresh();
    });
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={root}>
      <button className="bell" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <BellIcon />
        {unread > 0 && <span className="dot">{unread}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <b>Notifications</b>
            {unread > 0 && (
              <button type="button" className="btn xs ghost" onClick={markRead}>
                Mark all read
              </button>
            )}
          </div>
          <div className="notif-list">
            {shown.length === 0 ? (
              <p className="notif muted">Nothing yet. Notices about your matches, results and prizes show up here.</p>
            ) : (
              shown.map((n) => (
                <Link key={n.id} href={n.link || "/notifications"} className={`notif ${n.read ? "" : "unread"}`} onClick={() => setOpen(false)} style={{ color: "inherit", textDecoration: "none" }}>
                  <span className="ndot" />
                  <span>
                    {n.body}
                    <small>{n.when}</small>
                  </span>
                </Link>
              ))
            )}
          </div>
          <div className="notif-head" style={{ borderBottom: 0, borderTop: "1px solid var(--line)" }}>
            <Link href="/notifications" className="small" onClick={() => setOpen(false)}>
              See all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

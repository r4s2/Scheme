"use client";

import { useEffect, useState } from "react";

export interface ToastInput {
  message: string;
  tone?: "ok" | "err";
  /** Shows an Undo button that runs this. */
  undo?: () => void;
}

const EVENT = "scheme:toast";

/** Show a short notice at the bottom of the screen. Safe to call from any client component. */
export function toast(t: ToastInput) {
  window.dispatchEvent(new CustomEvent<ToastInput>(EVENT, { detail: t }));
}

/**
 * Wrap a form action so its result shows as a notice the moment it finishes,
 * even if the form itself disappears when the page updates.
 */
export function withNotice<R extends { ok: boolean; message: string }, P>(action: (prev: P, fd: FormData) => Promise<R>) {
  return async (prev: P, fd: FormData): Promise<R> => {
    const r = await action(prev, fd);
    toast({ message: r.message, tone: r.ok ? "ok" : "err" });
    return r;
  };
}

/** Renders notices from toast(). Mounted once, in the root layout. */
export function Toaster() {
  const [items, setItems] = useState<(ToastInput & { id: number })[]>([]);

  useEffect(() => {
    let seq = 0;
    const on = (e: Event) => {
      const t = { ...(e as CustomEvent<ToastInput>).detail, id: ++seq };
      setItems((xs) => [...xs.slice(-2), t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.undo ? 7000 : t.tone === "err" ? 6000 : 4200);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone === "err" ? "err" : ""}`} data-flash={t.tone ?? "ok"} role={t.tone === "err" ? "alert" : "status"}>
          <span>{t.message}</span>
          {t.undo && (
            <button
              type="button"
              onClick={() => {
                t.undo!();
                setItems((xs) => xs.filter((x) => x.id !== t.id));
              }}
            >
              Undo
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

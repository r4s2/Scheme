"use client";

import { useRef } from "react";
import { setActor } from "@/app/actions";

/** Development-only switcher: pick anyone and the page reloads as them. */
export function ActingAs({ actor, people }: { actor: string | null; people: { handle: string; label: string }[] }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form action={setActor} ref={form} className="devbar">
      <label htmlFor="acting-as">Acting as</label>
      <select id="acting-as" name="handle" defaultValue={actor ?? undefined} onChange={() => form.current?.requestSubmit()} aria-label="Acting as (development only)">
        {people.map((p) => (
          <option key={p.handle} value={p.handle}>
            {p.label}
          </option>
        ))}
      </select>
      <noscript>
        <button className="btn xs">Switch</button>
      </noscript>
    </form>
  );
}

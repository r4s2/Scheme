"use client";

import { useState } from "react";
import { TeamSignup, type RosterEdit } from "./TeamSignup";

type FormProps = Omit<React.ComponentProps<typeof TeamSignup>, "edit" | "onDone">;

/** The captain's view of a registered team: a summary with "Edit roster", which opens the roster form in place. */
export function RosterEditor({ summary, actions, edit, ...form }: FormProps & { summary: React.ReactNode; actions?: React.ReactNode; edit: RosterEdit }) {
  const [open, setOpen] = useState(false);
  if (open) return <TeamSignup {...form} edit={edit} onDone={() => setOpen(false)} />;
  return (
    <div className="row" style={{ justifyContent: "space-between" }}>
      <div>{summary}</div>
      <div className="row">
        <button type="button" className="btn sm" onClick={() => setOpen(true)}>
          Edit roster
        </button>
        {actions}
      </div>
    </div>
  );
}

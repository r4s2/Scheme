"use client";

import { useActionState } from "react";
import { teamAction, type TeamResult } from "@/app/teams/actions";
import { withNotice } from "@/components/Toaster";

/** Runs the action and shows its result as a notice. */
const run = withNotice(teamAction);

/** A form that changes a saved team in place and reports back with a notice. */
export function TeamOp({ op, rosterId, children, className }: { op: string; rosterId?: string; children: React.ReactNode; className?: string }) {
  const [, action, pending] = useActionState<TeamResult | null, FormData>(run, null);
  return (
    <form action={action} className={className ?? "row"} style={{ gap: 6 }} data-pending={pending || undefined}>
      <input type="hidden" name="op" value={op} />
      {rosterId && <input type="hidden" name="rosterId" value={rosterId} />}
      {children}
    </form>
  );
}

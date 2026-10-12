"use client";

import { useActionState } from "react";
import { runOp, type OpResult } from "@/app/t/[id]/actions";
import { withNotice } from "@/components/Toaster";
import ui from "../ui.module.css";

/** Runs the action and shows its result as a notice. */
const run = withNotice(runOp);

/**
 * A form that runs one tournament operation in place: no page reload, the
 * page's data refreshes and the result shows as a notice.
 */
export function Op({
  tid,
  op,
  tab,
  children,
  className,
}: {
  tid: string;
  op: string;
  tab?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [, action, pending] = useActionState<OpResult | null, FormData>(run, null);
  return (
    <form action={action} className={className ?? ui.inline} aria-busy={pending} data-pending={pending || undefined}>
      <input type="hidden" name="tournamentId" value={tid} />
      <input type="hidden" name="op" value={op} />
      {tab && <input type="hidden" name="tab" value={tab} />}
      {children}
    </form>
  );
}

export function Hidden({ name, value }: { name: string; value: string | number }) {
  return <input type="hidden" name={name} value={value} />;
}

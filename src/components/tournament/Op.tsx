"use client";

import { useActionState, useEffect } from "react";
import { runOp, type OpResult } from "@/app/t/[id]/actions";
import { toast } from "@/components/Toaster";
import ui from "../ui.module.css";

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
  const [result, action, pending] = useActionState<OpResult | null, FormData>(runOp, null);
  useEffect(() => {
    if (result) toast({ message: result.message, tone: result.ok ? "ok" : "err" });
  }, [result]);
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

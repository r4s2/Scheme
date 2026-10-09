import { runOperation } from "@/app/t/[id]/actions";
import ui from "../ui.module.css";

/** A form that runs one tournament operation and returns to the same tab. */
export function Op({
  tid,
  op,
  tab,
  children,
  className,
}: {
  tid: string;
  op: string;
  tab: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <form action={runOperation} className={className ?? ui.inline}>
      <input type="hidden" name="tournamentId" value={tid} />
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="tab" value={tab} />
      {children}
    </form>
  );
}

export function Hidden({ name, value }: { name: string; value: string | number }) {
  return <input type="hidden" name={name} value={value} />;
}

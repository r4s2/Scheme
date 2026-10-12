import { Wizard } from "@/components/host/Wizard";
import { getStore } from "@/server/store";
import { currentActor } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Host a tournament · Scheme" };

export default async function HostPage() {
  const actor = await currentActor();
  if (!actor) {
    return (
      <main>
        <h1 className="page-title">Host a tournament</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Sign in to host.
        </p>
      </main>
    );
  }
  const [me] = await getStore().profiles([actor]);
  return (
    <main>
      <div className="crumbs">Host a tournament</div>
      <h1 className="page-title" style={{ marginBottom: 18 }}>
        Set up your tournament
      </h1>
      <Wizard hostKarma={me?.hostKarma ?? 70} now={new Date().toISOString()} />
    </main>
  );
}

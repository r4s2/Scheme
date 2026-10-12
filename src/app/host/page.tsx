import { redirect } from "next/navigation";

/** Hosting lives on My tournaments now. */
export default function HostPage() {
  redirect("/mine?new=1");
}

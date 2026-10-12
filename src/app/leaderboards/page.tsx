import { redirect } from "next/navigation";

/** Leaderboards live in the Teams library now. */
export default function LeaderboardsPage() {
  redirect("/teams");
}

import { redirect } from "next/navigation";

export const metadata = { title: "Call follow-ups | Senior Phone AI" };
export default function FollowupsPage() { redirect("/calls#phone-transcript-heading"); }

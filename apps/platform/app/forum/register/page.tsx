import { redirect } from "next/navigation";

export default function ForumRegisterAliasPage() {
  redirect("/signin?mode=signUp&redirectTo=/forum");
}

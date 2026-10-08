import { redirect } from "next/navigation";

export default function ForumLoginAliasPage() {
  redirect("/signin?mode=signIn&redirectTo=/forum");
}

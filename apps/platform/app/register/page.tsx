import { redirect } from "next/navigation";

export default function RegisterAliasPage() {
  redirect("/signin?mode=signUp&redirectTo=/forum");
}

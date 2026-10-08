import { redirect } from "next/navigation";

export default function LoginAliasPage() {
  redirect("/signin?mode=signIn&redirectTo=/forum");
}

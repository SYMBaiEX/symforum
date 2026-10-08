import { redirect } from "next/navigation";

export default function SignupAliasPage() {
  redirect("/signin?mode=signUp&redirectTo=/forum");
}

import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import type { Value } from "convex/values";
import type { DataModel } from "./_generated/dataModel";

const USERNAME_PATTERN = /^sym-\d{1,8}$|^[a-z0-9][a-z0-9_-]{2,31}$/;

function normalizeUsername(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Username is required");
  }
  const usernameNormalized = value.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(usernameNormalized)) {
    throw new Error(
      "Use 3-32 letters, numbers, underscores, or dashes. SYM handles are also supported.",
    );
  }
  return usernameNormalized;
}

function usernameCredential(usernameNormalized: string) {
  return `${usernameNormalized}@users.symbaiex.local`;
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password<DataModel>({
      profile(params: Record<string, Value | undefined>) {
        const usernameNormalized = normalizeUsername(params.username);
        const username = usernameNormalized.toUpperCase().startsWith("SYM-")
          ? usernameNormalized.toUpperCase()
          : usernameNormalized;
        const contactEmail =
          typeof params.contactEmail === "string" &&
          params.contactEmail.includes("@")
            ? params.contactEmail.trim().toLowerCase()
            : undefined;

        return {
          email: usernameCredential(usernameNormalized),
          name: username,
          username,
          usernameNormalized,
          usernameSource: username.startsWith("SYM-") ? "auto" : "chosen",
          role: "reader",
          contactEmail,
          onboardedAt: Date.now(),
        };
      },
      validatePasswordRequirements(password: string) {
        if (password.length < 8) {
          throw new Error("Password must be at least 8 characters.");
        }
      },
    }),
  ],
});

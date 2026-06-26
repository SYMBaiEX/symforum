import { CurrentProfilePanel } from "@/components/current-profile-panel";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Profile",
};

export default function ProfilePage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <>
      <section className="page-frame">
        <div className="mb-7">
          <p className="page-kicker">
            Signed-in profile
          </p>
          <h1 className="page-title-display mt-3">
            Profile
          </h1>
        </div>
        {configured ? (
          <CurrentProfilePanel />
        ) : (
          <div>
            <p className="font-mono text-xs uppercase text-muted-foreground">
              Local setup
            </p>
            <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground md:text-base">
              Convex is not connected locally, so the authenticated profile view
              is unavailable in this environment.
            </p>
          </div>
        )}
      </section>
    </>
  );
}

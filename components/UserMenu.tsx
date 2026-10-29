"use client";

import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User } from "lucide-react";
import { ReactNode } from "react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { useAuthActions } from "@convex-dev/auth/react";
import { signOutIdentity } from "@symbaiex/auth/identity-client";
import Link from "next/link";

export function UserMenu({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium">
      {children}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="icon">
            <User />
            <span className="sr-only">Toggle user menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{children}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="flex items-center gap-2 py-0 font-normal">
            Theme
            <ThemeToggle />
          </DropdownMenuLabel>
          <SignOutButton />
          {process.env.NEXT_PUBLIC_BETTER_AUTH_ENABLED === "true" && <DropdownMenuItem asChild><Link href="/account/connections">Account connections</Link></DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SignOutButton() {
  if (process.env.NEXT_PUBLIC_BETTER_AUTH_ENABLED === "true") return <DropdownMenuItem onClick={() => void signOutIdentity()}>Sign out</DropdownMenuItem>;
  if (process.env.NEXT_PUBLIC_WORKOS_ENABLED === "true") {
    return <WorkOSSignOutButton />;
  }
  return <LegacySignOutButton />;
}

function WorkOSSignOutButton() {
  const { signOut } = useAuth();
  return (
    <DropdownMenuItem onClick={() => void signOut()}>Sign out</DropdownMenuItem>
  );
}

function LegacySignOutButton() {
  const { signOut } = useAuthActions();
  return (
    <DropdownMenuItem onClick={() => void signOut()}>Sign out</DropdownMenuItem>
  );
}

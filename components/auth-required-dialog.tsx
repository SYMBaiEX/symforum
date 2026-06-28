"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Link from "next/link";

export function AuthRequiredDialog({
  action = "continue",
  open,
  redirectTo,
  setOpen,
}: {
  action?: string;
  open: boolean;
  redirectTo: string;
  setOpen: (open: boolean) => void;
}) {
  const safeRedirect = safeRedirectTo(redirectTo);
  const encodedRedirect = encodeURIComponent(safeRedirect);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="rounded-none border-row-border sm:max-w-sm sm:rounded-none">
        <DialogHeader>
          <DialogTitle>Use a SYM handle</DialogTitle>
          <DialogDescription>
            Sign in or create a handle to {action}. Your votes, saves, and
            replies stay attached to your profile.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-start sm:space-x-0">
          <Button asChild>
            <Link
              href={`/signin?mode=signUp&redirectTo=${encodedRedirect}`}
              prefetch
            >
              Sign up
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link
              href={`/signin?mode=signIn&redirectTo=${encodedRedirect}`}
              prefetch
            >
              Sign in
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function safeRedirectTo(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

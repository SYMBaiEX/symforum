"use client";

import { createContext, useContext, type ReactNode } from "react";

type ForumShellContextValue = {
  primarySiteHref: string;
};

const ForumShellContext = createContext<ForumShellContextValue>({
  primarySiteHref: "/",
});

export function ForumShellContextProvider({
  children,
  primarySiteHref,
}: {
  children: ReactNode;
  primarySiteHref: string;
}) {
  return (
    <ForumShellContext.Provider value={{ primarySiteHref }}>
      {children}
    </ForumShellContext.Provider>
  );
}

export function useForumShellContext() {
  return useContext(ForumShellContext);
}

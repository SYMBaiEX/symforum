"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type ForumShellContextValue = {
  primarySiteHref: string;
  compactNavigation: boolean;
  toggleNavigation: () => void;
};

const ForumShellContext = createContext<ForumShellContextValue>({
  primarySiteHref: "/",
  compactNavigation: false,
  toggleNavigation: () => {},
});

export function ForumShellContextProvider({
  children,
  primarySiteHref,
}: {
  children: ReactNode;
  primarySiteHref: string;
}) {
  const [compactNavigation, setCompactNavigation] = useState(false);
  return (
    <ForumShellContext.Provider
      value={{
        primarySiteHref,
        compactNavigation,
        toggleNavigation: () => setCompactNavigation((value) => !value),
      }}
    >
      {children}
    </ForumShellContext.Provider>
  );
}

export function useForumShellContext() {
  return useContext(ForumShellContext);
}

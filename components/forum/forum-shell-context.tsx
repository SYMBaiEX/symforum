"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type ForumShellContextValue = {
  primarySiteHref: string;
  compactNavigation: boolean;
  toggleNavigation: () => void;
  density: "comfortable" | "compact";
  setDensity: (density: "comfortable" | "compact") => void;
};

const ForumShellContext = createContext<ForumShellContextValue>({
  primarySiteHref: "/",
  compactNavigation: false,
  toggleNavigation: () => {},
  density: "comfortable",
  setDensity: () => {},
});

export function ForumShellContextProvider({
  children,
  primarySiteHref,
}: {
  children: ReactNode;
  primarySiteHref: string;
}) {
  const [compactNavigation, setCompactNavigation] = useState(false);
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  return (
    <ForumShellContext.Provider
      value={{
        primarySiteHref,
        compactNavigation,
        toggleNavigation: () => setCompactNavigation((value) => !value),
        density,
        setDensity,
      }}
    >
      {children}
    </ForumShellContext.Provider>
  );
}

export function useForumShellContext() {
  return useContext(ForumShellContext);
}

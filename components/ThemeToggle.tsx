"use client";

import { Button } from "@/components/ui/button";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const themeSequence = ["light", "dark", "system"] as const;
type ThemePreference = (typeof themeSequence)[number];

const themeLabels: Record<ThemePreference, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

function isThemePreference(
  value: string | undefined,
): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentTheme = isThemePreference(theme) ? theme : "system";
  const nextTheme =
    themeSequence[
      (themeSequence.indexOf(currentTheme) + 1) % themeSequence.length
    ];
  const Icon =
    !mounted || currentTheme === "system"
      ? Monitor
      : currentTheme === "dark"
        ? Moon
        : Sun;

  return (
    <Button
      aria-label={`Theme: ${themeLabels[currentTheme]}. Switch to ${themeLabels[nextTheme]}.`}
      className="border border-row-border bg-background/70 hover:border-foreground"
      onClick={() => setTheme(nextTheme)}
      size="icon"
      title={`Theme: ${themeLabels[currentTheme]}`}
      type="button"
      variant="ghost"
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}

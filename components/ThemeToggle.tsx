"use client";

import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const themeSequence = ["light", "dark"] as const;
type ThemePreference = (typeof themeSequence)[number];

const themeLabels: Record<ThemePreference, string> = {
  light: "Light",
  dark: "Dark",
};

function isThemePreference(
  value: string | undefined,
): value is ThemePreference {
  return value === "light" || value === "dark";
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !isThemePreference(theme)) {
      setTheme("dark");
    }
  }, [mounted, setTheme, theme]);

  const currentTheme = mounted && isThemePreference(theme) ? theme : "dark";
  const nextTheme =
    themeSequence[
      (themeSequence.indexOf(currentTheme) + 1) % themeSequence.length
    ];
  const Icon = currentTheme === "dark" ? Moon : Sun;

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

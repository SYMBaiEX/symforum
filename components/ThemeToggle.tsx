"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <ToggleGroup type="single" size="sm" onValueChange={setTheme} value={theme}>
      <ToggleGroupItem value="light" aria-label="Light">
        <Sun />
      </ToggleGroupItem>
      <ToggleGroupItem value="dark" aria-label="Dark">
        <Moon />
      </ToggleGroupItem>
      <ToggleGroupItem value="system" aria-label="System">
        <Monitor />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

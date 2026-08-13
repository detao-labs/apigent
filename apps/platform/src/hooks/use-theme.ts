"use client";

import * as React from "react";

const THEME_KEY = "apigent-theme";

export type ThemeMode = "light" | "dark" | "system";

export function useTheme() {
  const [mode, setMode] = React.useState<ThemeMode | null>(null);
  const [systemDark, setSystemDark] = React.useState(false);

  React.useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY) as ThemeMode | null;
    setMode(
      stored === "light" || stored === "dark" ? stored : "system",
    );
    setSystemDark(
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    );
  }, []);

  // 跟随系统模式：监听系统主题变化
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) =>
      setSystemDark(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  React.useEffect(() => {
    if (mode === null) return;
    localStorage.setItem(THEME_KEY, mode);
    const dark =
      mode === "dark" || (mode === "system" && systemDark);
    document.documentElement.classList.toggle("dark", dark);
  }, [mode, systemDark]);

  const resolved =
    mode === null
      ? null
      : mode === "dark" || (mode === "system" && systemDark);

  return { mode, resolved, setMode };
}

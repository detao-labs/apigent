"use client"

import * as React from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// ═══════════════════════════════════════════════════════════════════
// Sonner Toaster — shadcn 标准消息提示
// ═══════════════════════════════════════════════════════════════════
// 用法：根布局挂 <Toaster />；组件内 `import { toast } from "sonner"`。
// 主题跟随项目 html.dark class（MutationObserver 同步）。
// ═══════════════════════════════════════════════════════════════════

const Toaster = ({ ...props }: ToasterProps) => {
  const [theme, setTheme] = React.useState<"light" | "dark">("light");

  React.useEffect(() => {
    const update = () =>
      setTheme(
        document.documentElement.classList.contains("dark") ? "dark" : "light",
      );
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };

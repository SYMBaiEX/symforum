/** Shared Forum palette and shape tokens for the website and embedded MCP App. */
export const FORUM_SHARED_THEME_CSS = `
:root {
  --forum-background-light: 0 0% 93%;
  --forum-foreground-light: 0 0% 3%;
  --forum-card-light: 0 0% 96%;
  --forum-muted-light: 0 0% 88%;
  --forum-muted-foreground-light: 0 0% 30%;
  --forum-border-light: 0 0% 72%;
  --forum-row-border-light: 0 0% 64%;
  --forum-scrollbar-track-light: 0 0% 88%;
  --forum-scrollbar-thumb-light: 0 0% 26%;
  --forum-primary-light: 319 100% 40%;
  --forum-scrollbar-hover-light: 319 100% 43%;
  --forum-chart-one-light: 319 100% 49%;

  --forum-background-dark: 0 0% 3%;
  --forum-foreground-dark: 0 0% 98%;
  --forum-card-dark: 0 0% 5%;
  --forum-muted-dark: 0 0% 11%;
  --forum-muted-foreground-dark: 0 0% 68%;
  --forum-border-dark: 0 0% 18%;
  --forum-row-border-dark: 0 0% 22%;
  --forum-scrollbar-track-dark: 0 0% 6%;
  --forum-scrollbar-thumb-dark: 0 0% 42%;
  --forum-primary-dark: 319 100% 46%;
  --forum-scrollbar-hover-dark: 319 100% 61%;
  --forum-chart-one-dark: 319 100% 61%;

  --forum-cyan: 174 54% 67%;
  --forum-gold: 52 100% 56%;
  --forum-accent-magenta: #fa00a8;
  --forum-radius: 0.125rem;
}
`;

export const FORUM_PLUGIN_THEME_CSS = `${FORUM_SHARED_THEME_CSS}
:root{color-scheme:light;--bg:hsl(var(--forum-background-light));--panel:hsl(var(--forum-card-light));--ink:hsl(var(--forum-foreground-light));--muted:hsl(var(--forum-muted-foreground-light));--line:hsl(var(--forum-border-light));--accent:hsl(var(--forum-primary-light));--accent-ink:#fff;--soft:hsl(var(--forum-muted-light));--cyan:hsl(var(--forum-cyan));--gold:hsl(var(--forum-gold));font:15px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--bg:hsl(var(--forum-background-dark));--panel:hsl(var(--forum-card-dark));--ink:hsl(var(--forum-foreground-dark));--muted:hsl(var(--forum-muted-foreground-dark));--line:hsl(var(--forum-border-dark));--accent:hsl(var(--forum-primary-dark));--soft:hsl(var(--forum-muted-dark))}}
:root[data-theme=light]{color-scheme:light;--bg:hsl(var(--forum-background-light));--panel:hsl(var(--forum-card-light));--ink:hsl(var(--forum-foreground-light));--muted:hsl(var(--forum-muted-foreground-light));--line:hsl(var(--forum-border-light));--accent:hsl(var(--forum-primary-light));--soft:hsl(var(--forum-muted-light))}
:root[data-theme=dark]{color-scheme:dark;--bg:hsl(var(--forum-background-dark));--panel:hsl(var(--forum-card-dark));--ink:hsl(var(--forum-foreground-dark));--muted:hsl(var(--forum-muted-foreground-dark));--line:hsl(var(--forum-border-dark));--accent:hsl(var(--forum-primary-dark));--soft:hsl(var(--forum-muted-dark))}
`;

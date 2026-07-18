export const THEME_KEYS = [
  'canvas', 'surface', 'surfaceRaised', 'surfaceBrand', 'border', 'borderStrong',
  'textPrimary', 'textMuted', 'textSubtle', 'textOnPrimary', 'primary',
  'primaryHover', 'success', 'warning', 'danger', 'info',
] as const;
export type ThemeKey = typeof THEME_KEYS[number];
export type ThemeTokens = Record<ThemeKey, string>;

// Exact current Beacon palette. This keeps the app usable if the branding API
// is unavailable and serves as the immutable shipped Default theme.
export const defaultTheme: ThemeTokens = {
  canvas: '#0c0e16', surface: '#141720', surfaceRaised: '#1c1f2e', surfaceBrand: '#1a0a2e',
  border: '#232638', borderStrong: '#2d3148', textPrimary: '#d8daf0', textMuted: '#616480',
  textSubtle: '#8486a8', textOnPrimary: '#ffffff', primary: '#4e7ef7', primaryHover: '#3b6fd4',
  success: '#2dcfa0', warning: '#f0a840', danger: '#e8566a', info: '#4e7ef7',
};

const cssNames: Record<ThemeKey, string> = {
  canvas: '--color-canvas', surface: '--color-surface', surfaceRaised: '--color-surface-raised', surfaceBrand: '--color-surface-brand',
  border: '--color-border', borderStrong: '--color-border-strong', textPrimary: '--color-text-primary', textMuted: '--color-text-muted',
  textSubtle: '--color-text-subtle', textOnPrimary: '--color-text-on-primary', primary: '--color-primary', primaryHover: '--color-primary-hover',
  success: '--color-success', warning: '--color-warning', danger: '--color-danger', info: '--color-info',
};

export function applyTheme(tokens: ThemeTokens) {
  for (const key of THEME_KEYS) document.documentElement.style.setProperty(cssNames[key], tokens[key]);
}

function validTokens(value: unknown): value is ThemeTokens {
  if (!value || typeof value !== 'object') return false;
  const values = value as Record<string, unknown>;
  return THEME_KEYS.every(key => /^#[0-9a-f]{6}$/i.test(String(values[key] ?? '')));
}

export async function loadActiveTheme(): Promise<void> {
  applyTheme(defaultTheme);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2500);
  try {
    const baseUrl = import.meta.env.VITE_API_URL ?? '';
    const active = await fetch(`${baseUrl}/v1/branding/active`, { signal: controller.signal, cache: 'no-store' });
    if (!active.ok) return;
    const { revisionId } = await active.json() as { revisionId?: string };
    if (!revisionId) return;
    const palette = await fetch(`${baseUrl}/v1/branding/revisions/${encodeURIComponent(revisionId)}`, { signal: controller.signal });
    if (!palette.ok) return;
    const { tokens } = await palette.json() as { tokens?: unknown };
    if (validTokens(tokens)) applyTheme(tokens);
  } catch {
    // Default stays active: login must never be held hostage by branding.
  } finally {
    window.clearTimeout(timeout);
  }
}

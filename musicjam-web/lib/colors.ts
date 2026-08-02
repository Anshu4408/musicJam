/**
 * colors.ts — Design tokens mirroring the original React Native app
 * Extended with web-specific alpha utilities
 */

export const COLORS = {
  bg:            '#050A0F',
  surface:       '#0D1520',
  surfaceLight:  '#111D2E',
  border:        '#1A2E44',
  neonBlue:      '#00D4FF',
  neonPurple:    '#8B5CF6',
  neonGreen:     '#10B981',
  neonRed:       '#EF4444',
  neonOrange:    '#F97316',
  textPrimary:   '#F0F6FF',
  textSecondary: '#7A9AB8',
  textMuted:     '#3D5A73',
} as const;

/** Append hex alpha to a 6-digit hex color, e.g. alpha('#00D4FF', 0.2) → '#00D4FF33' */
export function alpha(hex: string, opacity: number): string {
  const a = Math.round(opacity * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

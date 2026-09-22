/**
 * Design tokens - the single source of truth for the visual system (DECISIONS.md D-008).
 *
 * Palette is derived from the reference design supplied by the user: soft mint ground, deep
 * teal primary with a gradient hero, white rounded cards, pastel icon chips, and a floating
 * white pill tab bar. Screens never hard-code these values; they consume components from
 * `src/ui`, which read from here. The final design handoff swaps this file (and component
 * styling) without touching business logic.
 */

export const palette = {
  // Ground and surfaces
  ground: '#EEF8F3',        // app background (mint-tinted white)
  groundDeep: '#E2F4EB',    // section backgrounds, special-offer card
  surface: '#FFFFFF',       // cards, tab bar
  surfaceMuted: '#EEF3F0',  // search field, inputs
  border: '#DCEAE2',
  borderStrong: '#C3D9CE',

  // Brand teal
  primary: '#0E8A6A',
  primaryPressed: '#0B6F55',
  primaryDeep: '#0A5E48',
  primarySoft: '#D9F1E7',   // icon chip / badge background
  primaryGlow: 'rgba(14, 138, 106, 0.16)',
  gradientStart: '#0B7C5F',
  gradientEnd: '#15A883',

  // Text
  text: '#10231C',
  textSecondary: '#5B6E67',
  textMuted: '#8FA39B',
  textOnPrimary: '#FFFFFF',
  textOnPrimaryMuted: 'rgba(255,255,255,0.82)',

  // Semantic
  success: '#16A34A',
  successSoft: '#DCF5E6',
  warning: '#E0A400',
  warningSoft: '#FFF2CC',
  danger: '#E5484D',
  dangerSoft: '#FDE2E3',
  info: '#2F6FED',
  infoSoft: '#DCE9FF',

  // Accent chips for categories (pastel background + saturated icon)
  chip: {
    teal: { bg: '#CDEFE3', fg: '#0E8A6A' },
    amber: { bg: '#FFF0CC', fg: '#E58E00' },
    slate: { bg: '#ECEFF1', fg: '#5F6B72' },
    blue: { bg: '#DCEBFF', fg: '#2F6FED' },
    pink: { bg: '#FDE1EC', fg: '#E0457B' },
    mint: { bg: '#DCF5EA', fg: '#1C9C6E' },
    sky: { bg: '#DCE9FF', fg: '#3B7BE0' },
    rose: { bg: '#FDE3E7', fg: '#E5484D' },
  },

  // Special
  gold: '#F2C14E',
  overlay: 'rgba(16, 35, 28, 0.45)',
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  screen: 20, // horizontal screen padding from the reference
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
} as const;

export const typography = {
  family: {
    // Poppins - the geometric face used in the reference design. Loaded in app/_layout.tsx.
    regular: 'Poppins_400Regular',
    medium: 'Poppins_500Medium',
    semibold: 'Poppins_600SemiBold',
    bold: 'Poppins_700Bold',
    extrabold: 'Poppins_800ExtraBold',
  },
  size: {
    display: 30,
    title: 24,
    heading: 20,
    subheading: 17,
    body: 16,
    label: 15,
    caption: 13,
    micro: 11,
  },
  lineHeight: {
    display: 36,
    title: 30,
    heading: 26,
    subheading: 23,
    body: 22,
    label: 20,
    caption: 18,
    micro: 14,
  },
  weight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
} as const;

export const elevation = {
  card: {
    shadowColor: '#0E8A6A',
    shadowOpacity: 0.05,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  floating: {
    shadowColor: '#10231C',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
} as const;

export const layout = {
  touchTarget: 48,       // minimum accessible tap size
  tabBarHeight: 72,
  tabBarMargin: 16,
  iconChip: 56,
  avatar: 44,
} as const;

export const theme = { palette, spacing, radius, typography, elevation, layout } as const;
export type Theme = typeof theme;

/**
 * Design tokens - the single source of truth for the visual system (DECISIONS.md D-008).
 *
 * Palette is derived from the reference design supplied by the user: soft mint ground, deep
 * teal primary with a gradient hero, white rounded cards, pastel icon chips, and a floating
 * white pill tab bar. Screens never hard-code these values; they consume components from
 * `src/ui`, which read from here. The final design handoff swaps this file (and component
 * styling) without touching business logic.
 *
 * Several foregrounds are a shade darker than the reference. `scripts/a11y-audit.mjs` computes
 * the WCAG contrast of every pairing the app actually renders, and these are the values that
 * clear AA against the hardest background they sit on. Only the foregrounds moved: the mint
 * grounds, the white cards and the pastel chip backgrounds are untouched, because they are what
 * the design looks like, while the text on top of them is what it is for.
 *
 * `primary` is a fill - buttons, icons, borders - and is held to the 3:1 that WCAG asks of
 * non-text, plus enough to carry white label text. Teal *text* on a light ground cannot reach
 * 4.5:1 without ceasing to be the brand teal, so it does not try: `Text` renders tone="primary"
 * in `primaryDeep` instead.
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
  primary: '#0D8265',      // AA against white for a button label; the reference teal, a shade down
  primaryPressed: '#0B6F55',
  primaryDeep: '#0A5E48',
  primarySoft: '#D9F1E7',   // icon chip / badge background
  primaryGlow: 'rgba(14, 138, 106, 0.16)',
  gradientStart: '#0B7C5F',
  // The hero gradient's light end. It is darker than the reference, and that is the one place
  // accessibility cost the design something: the original end was light enough that 13px white
  // caption text on it sat at 2.5:1. The sweep is narrower now, but every word on the hero is
  // legible, including the muted ones.
  gradientEnd: '#108065',

  // Text
  text: '#10231C',
  textSecondary: '#5B6E67',
  textMuted: '#63706B',
  textOnPrimary: '#FFFFFF',
  textOnPrimaryMuted: 'rgba(255,255,255,0.94)',

  // Semantic
  success: '#117D39',
  successSoft: '#DCF5E6',
  warning: '#8D6700',
  warningSoft: '#FFF2CC',
  danger: '#BB3B3F',
  dangerSoft: '#FDE2E3',
  info: '#2A62D2',
  infoSoft: '#DCE9FF',

  // Accent chips for categories (pastel background + saturated icon)
  chip: {
    teal: { bg: '#CDEFE3', fg: '#0E8A6A' },
    amber: { bg: '#FFF0CC', fg: '#C57A00' },
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

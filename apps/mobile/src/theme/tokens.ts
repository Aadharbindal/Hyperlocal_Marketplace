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
    violet: { bg: '#EDE7FB', fg: '#6D4AC4' },
  },

  // Hero banner, sampled from the reference render (DECISIONS D-011)
  /** The mint the second headline line is set in - pale enough to stay well clear of AA on the gradient. */
  heroTitleAccent: '#C2F7E6',
  /** The bright green square behind the little house in the brand chip. */
  heroAccent: '#04A37D',

  // Special
  /**
   * Ornament only - 2.1:1, so nothing that carries information may be painted with it.
   *
   * It was on the stars in four places, including two interactive rating controls, and the contrast
   * audit never objected because `gold` is a palette token and the audit only measures *literals*.
   * That is a real hole in the check and worth knowing about: a token is not automatically safe for
   * every use, it is safe for the use it was chosen for. Meaningful stars use `ratingOn`.
   */
  gold: '#F2C14E',
  overlay: 'rgba(16, 35, 28, 0.45)',

  // ---------------------------------------------------------------------------
  // Values the screens had invented for themselves
  // ---------------------------------------------------------------------------
  /**
   * Thirty-odd screens were painting with literal hexes that were never in this file - thirty uses
   * of `#F6FBF9`, twenty-nine of `#A9B8B1`, eleven of `#8A6400`. None of it was visible to the
   * contrast audit, because that only reads `color:` inside a StyleSheet and these arrived as JSX
   * props. Two of them were straightforwardly broken:
   *
   * - `#A9B8B1`, the placeholder colour on every hand-rolled input, sits at **2.06:1** on white.
   *   A placeholder is usually the only example of what a field wants, so it is content, and 2:1
   *   is not readable content. `inputPlaceholder` below is the same grey-green darkened until it
   *   clears AA, which is a visible change and the right one.
   * - `#B26A00`, the amber on warning rows, sits at **4.24:1** - just under. `warningIcon` is for
   *   the glyph beside the text, where 3:1 is the bar; the words use `warning`.
   *
   * The rest are named rather than changed: they looked right, they simply had nowhere to live, so
   * every screen re-typed them slightly differently and the system drifted one commit at a time.
   */
  /** The faintest fill in the system - inset rows, read-only blocks, table stripes. */
  surfaceSunken: '#F6FBF9',
  /** A hairline between rows inside a card, lighter than `border` around one. */
  borderSoft: '#E4EDE9',
  /** Placeholder text. Darkened from the `#A9B8B1` the screens used: 2.06:1 -> AA. */
  inputPlaceholder: '#5F6F68',
  /**
   * A disabled glyph, or the unfilled half of a rating.
   *
   * Never text, so AA does not apply - but it is not decoration either. An empty star is what tells
   * somebody the control has five of them, so it has to clear the 3:1 WCAG asks of a meaningful
   * non-text element. The `#C2CEC9` the screens used for this sat at 1.44:1, which on a phone in
   * daylight is an invisible control.
   *
   * The first attempt at this was `#7D8F88`, which cleared 3:1 on three of the four surfaces and
   * landed at **2.984** on `groundDeep` - caught by the audit, not by me, which is the whole reason
   * for having the thing compute ratios instead of eyeballing them.
   */
  iconFaint: '#798A83',
  /** The amber glyph beside warning text. Non-text, so 3:1 is the bar it has to clear. */
  warningIcon: '#9A7000',
  /** Warning text on `warningSoft` rather than on white, where it needs to go darker still. */
  warningDeep: '#6B4700',
  /**
   * The amber on a filled star, and on an icon sitting in a warm chip.
   *
   * `gold` above is for ornament - it is 2.1:1 and belongs on things that carry no information. A
   * rating control is not one of those: in `AfterJobCard` the stars *are* the input, and the filled
   * ones were `#F0A400` at **1.83:1**, with the empty ones at 1.42:1. The shape differs too
   * (`star` against `star-outline`), so colour was never the only signal, but a control nobody can
   * see in daylight is still a control nobody can use.
   *
   * This value clears 3:1 on every app surface *and* on the `#FFE0A6` end of the warm gradient the
   * booking toggles use, which is the tightest background it has to work on.
   */
  ratingOn: '#B06A00',
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

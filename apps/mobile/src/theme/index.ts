export * from './tokens';

import { palette } from './tokens';

/** Category icon chip colours keyed by the API `iconKey`. Unknown keys fall back to teal. */
export const CATEGORY_CHIP: Record<string, { bg: string; fg: string; icon: string }> = {
  plumbing: { ...palette.chip.teal, icon: 'water' },
  electrical: { ...palette.chip.amber, icon: 'flash' },
  carpentry: { ...palette.chip.slate, icon: 'hammer' },
  appliance: { ...palette.chip.blue, icon: 'cog' },
  cleaning: { ...palette.chip.mint, icon: 'sparkles' },
  painting: { ...palette.chip.pink, icon: 'color-palette' },
  default: { ...palette.chip.teal, icon: 'construct' },
};

export function chipFor(iconKey: string) {
  return CATEGORY_CHIP[iconKey] ?? CATEGORY_CHIP.default!;
}

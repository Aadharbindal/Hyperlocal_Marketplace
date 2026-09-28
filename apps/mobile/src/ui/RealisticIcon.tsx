import React from 'react';
import { Image, View, type ImageSourcePropType, type ViewStyle } from 'react-native';
import ICON_CARPENTRY from '../../assets/categories/icon-carpentry.png';
import ICON_ELECTRICAL from '../../assets/categories/icon-electrical.png';
import ICON_PLUMBING from '../../assets/categories/icon-plumbing.png';
import {
  PlumbingIcon,
  ElectricalIcon,
  CarpentryIcon,
  ApplianceIcon,
  CleaningIcon,
  PaintingIcon,
  GeneralIcon,
} from './illustrations';

export interface RealisticIconProps {
  iconKey: string;
  size?: number;
  style?: ViewStyle;
}

/**
 * The rendered icons from the reference, for the categories that have one.
 *
 * These are cut out of the strip the user supplied, circle and all - the soft tint behind each
 * one is part of how it reads, and without it they look like clip art dropped on a card.
 * `category-icons.build.py` beside them does the cutting and can do it again from a new
 * reference.
 */
const RENDERED: Record<string, ImageSourcePropType> = {
  plumbing: ICON_PLUMBING,
  electrical: ICON_ELECTRICAL,
  carpentry: ICON_CARPENTRY,
};

/**
 * The drawn fallbacks, for categories the reference did not cover.
 *
 * Kept rather than deleted: the catalog can enable appliance repair, cleaning or painting
 * without waiting for artwork, and a category with no icon at all would render as a hole. When
 * the rendered set is completed these go.
 */
const DRAWN: Record<string, React.ComponentType<{ size: number }>> = {
  plumbing: PlumbingIcon,
  electrical: ElectricalIcon,
  carpentry: CarpentryIcon,
  appliance: ApplianceIcon,
  cleaning: CleaningIcon,
  painting: PaintingIcon,
};

export function RealisticIcon({ iconKey, size = 56, style }: RealisticIconProps) {
  const rendered = RENDERED[iconKey];
  const box: ViewStyle = { width: size, height: size, alignItems: 'center', justifyContent: 'center' };

  if (rendered) {
    return (
      <View style={[box, style]}>
        {/* Decorative: the category's name is always beside it, so a screen reader announcing
            "image" here would only be noise. */}
        <Image
          source={rendered}
          style={{ width: size, height: size }}
          resizeMode="contain"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </View>
    );
  }

  const Drawn = DRAWN[iconKey] ?? GeneralIcon;
  return (
    <View style={[box, style]}>
      <Drawn size={size} />
    </View>
  );
}

import React from 'react';
import { View, type ViewStyle } from 'react-native';
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

export function RealisticIcon({ iconKey, size = 56, style }: RealisticIconProps) {
  let IconComponent = GeneralIcon;

  switch (iconKey) {
    case 'plumbing':
      IconComponent = PlumbingIcon;
      break;
    case 'electrical':
      IconComponent = ElectricalIcon;
      break;
    case 'carpentry':
      IconComponent = CarpentryIcon;
      break;
    case 'appliance':
      IconComponent = ApplianceIcon;
      break;
    case 'cleaning':
      IconComponent = CleaningIcon;
      break;
    case 'painting':
      IconComponent = PaintingIcon;
      break;
    case 'default':
    default:
      IconComponent = GeneralIcon;
      break;
  }

  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      <IconComponent size={size} />
    </View>
  );
}

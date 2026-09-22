import { Stack } from 'expo-router';
import { palette } from '@/theme';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.ground }, animation: 'slide_from_right' }} />;
}

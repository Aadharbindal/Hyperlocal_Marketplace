import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { layout, palette, radius, spacing } from '@/theme';
import { Avatar, IconButton, Text } from '@/ui';

/**
 * The first thing anybody sees.
 *
 * It used to be one row: greeting, city picker, bell and avatar all competing for the same
 * line, with the greeting on `flex: 1` and everything else at a fixed width. On a real phone the
 * fixed items ate about a third of the row, so a 24px bold "Welcome!" had nowhere to go and
 * **broke mid-word into "Welc / ome!"** - with the city picker sitting on top of it. That is not
 * a spacing bug to nudge; a row cannot hold four things that all want to be first.
 *
 * So it is two rows now, which is also the honest hierarchy:
 *
 * - who you are and what has changed (avatar, greeting, bell)
 * - **where you are** - which in a hyperlocal marketplace is not a detail tucked beside a
 *   greeting, it is the single fact that decides which professionals exist for you. It gets its
 *   own line and reads like a control rather than a label.
 *
 * Three rules keep it from ever breaking again, whatever somebody's name or language is:
 * the name column can actually shrink (`minWidth: 0`, which flex children do not do by
 * default), the name is one line that scales down rather than wrapping, and the emoji lives
 * outside the text so it can neither affect line breaking nor be read aloud as "waving hand".
 */
export function HomeHeader({
  greeting,
  name,
  city,
  unread,
  onNotifications,
  onChangeCity,
}: {
  greeting: string;
  name: string;
  city: string;
  unread: number;
  onNotifications: () => void;
  onChangeCity: () => void;
}) {
  const reduced = useReducedMotion();

  return (
    <View style={styles.wrap}>
      <View style={styles.identity}>
        <Animated.View entering={reduced ? undefined : FadeInDown.duration(420)}>
          <Avatar name={name} />
        </Animated.View>

        {/* The column that is allowed to shrink. Without `minWidth: 0` a flex child refuses to
            go below its content width, which is exactly how the name got squeezed into a wrap. */}
        <View style={styles.names}>
          <Animated.View entering={reduced ? undefined : FadeInDown.delay(60).duration(420)}>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {greeting}
            </Text>
          </Animated.View>

          <Animated.View style={styles.nameRow} entering={reduced ? undefined : FadeInDown.delay(120).duration(420)}>
            <Text
              variant="title"
              weight="bold"
              numberOfLines={1}
              // Shrinks to fit rather than wrapping, so a long name degrades gracefully instead
              // of breaking across lines or being cut off with an ellipsis.
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              style={styles.name}
            >
              {name}
            </Text>
            <Wave reduced={reduced} />
          </Animated.View>
        </View>

        <Animated.View entering={reduced ? undefined : FadeInDown.delay(180).duration(420)}>
          <IconButton
            icon="notifications-outline"
            tone="plain"
            badge={unread > 0}
            accessibilityLabel={unread > 0 ? `Updates, ${unread} unread` : 'Updates'}
            onPress={onNotifications}
          />
        </Animated.View>
      </View>

      <Animated.View entering={reduced ? undefined : FadeInDown.delay(220).duration(420)}>
        <Pressable
          onPress={onChangeCity}
          accessible
          accessibilityRole="button"
          // Read as one sentence. Announcing "Delhi" alone would not tell somebody what tapping
          // it does, and announcing the pin and the chevron separately is noise.
          accessibilityLabel={`Serving ${city}. Change city`}
          style={({ pressed }) => [styles.city, pressed && styles.cityPressed]}
        >
          <View style={styles.cityInner} importantForAccessibility="no-hide-descendants">
            <Ionicons name="location" size={15} color={palette.primary} />
            <Text variant="caption" tone="secondary">
              Serving
            </Text>
            <Text variant="caption" weight="bold" style={{ color: palette.primaryDeep }}>
              {city}
            </Text>
            <Ionicons name="chevron-down" size={14} color={palette.textMuted} />
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

/**
 * The hand waves twice and then stops.
 *
 * A gesture that repeats forever stops being a greeting and becomes something moving in the
 * corner of somebody's eye while they are trying to read - and on this screen it would be
 * animating behind every scroll, for as long as the app is open. Twice is hello.
 *
 * Rotation only: the entrance animations on this screen already drive opacity, and animating
 * both on one node is what Reanimated warns about.
 */
function Wave({ reduced }: { reduced: boolean }) {
  const angle = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    angle.value = withDelay(
      420,
      withRepeat(
        withSequence(
          withTiming(16, { duration: 140, easing: Easing.out(Easing.quad) }),
          withTiming(-10, { duration: 160, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 140, easing: Easing.in(Easing.quad) }),
        ),
        2,
        false,
      ),
    );
  }, [angle, reduced]);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.value}deg` }] }));

  return (
    // Hidden from the accessibility tree: a screen reader would say "waving hand" after the
    // person's own name, which is not a greeting, it is a description of a picture.
    <Animated.View style={style} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Text variant="title">👋</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  // `minWidth: 0` is the whole fix: a flex child will not shrink below its content otherwise.
  names: { flex: 1, minWidth: 0, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  // `flexShrink` lets the name give way to the emoji rather than pushing it off the row.
  name: { flexShrink: 1 },
  city: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: spacing.md,
    minHeight: 36,
    justifyContent: 'center',
  },
  cityPressed: { backgroundColor: palette.primarySoft, borderColor: palette.primarySoft },
  cityInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});

export const HEADER_TOUCH_TARGET = layout.touchTarget;

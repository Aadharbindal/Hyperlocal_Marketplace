import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { checkFutureDateTime, type FieldProblem } from '@hyperlocal/core';
import { palette, radius, spacing } from '@/theme';
import { Text } from './Text';
import { TextField } from './TextField';

/**
 * `@react-native-community/datetimepicker`, loaded the way this app loads every native module.
 *
 * Same reason as `expo-location` and `react-native-maps`: a static import that throws on load takes
 * every export in the file with it, and the screen renders blank with an error about something
 * unrelated. Here the fallback is unusually important, because what it falls back *to* is the typed
 * field this component exists to replace - so a build without the module is degraded rather than
 * broken.
 */
type PickerModule = typeof import('@react-native-community/datetimepicker');
let cached: PickerModule | null | undefined;
function loadPicker(): PickerModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS === 'web') return (cached = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('@react-native-community/datetimepicker') as PickerModule;
  } catch {
    cached = null;
  }
  return cached;
}

interface Props {
  /** `null` until something is chosen. The caller owns the value, as with every other field here. */
  value: Date | null;
  onChange: (value: Date | null) => void;
  label: string;
  helper?: string;
  /** Shown instead of the helper, and overrides the component's own complaint. */
  error?: string | null;
  /** Nothing before this can be chosen. Defaults to now, because these are all future bookings. */
  minimumDate?: Date;
  maximumDate?: Date;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/**
 * Reads the chosen moment back the way a person would say it.
 *
 * "Tomorrow, 3:30 pm" rather than "2026-10-04 15:30", and the weekday by name for anything further
 * out, because "Saturday afternoon" is how somebody checks whether a slot actually suits them -
 * nobody holds the date-to-weekday mapping in their head.
 */
function describe(d: Date, now = new Date()): string {
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const sameDay = (a: Date, b: Date) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (sameDay(d, now)) return `Today, ${time}`;
  if (sameDay(d, tomorrow)) return `Tomorrow, ${time}`;
  const withinAWeek = d.getTime() - now.getTime() < 7 * 86_400_000;
  const day = withinAWeek
    ? WEEKDAYS[d.getDay()]
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${day}, ${time}`;
}

/**
 * A date and a time, picked.
 *
 * This replaces the worst interaction left in the app. Rescheduling a booking asked somebody to
 * type `2026-10-04 15:30` into a bare text box - which means knowing the format, knowing the
 * year, getting the 24-hour conversion right, and knowing which days exist in which month. It was
 * shipped knowingly as the smallest thing that made the feature reachable and recorded in
 * KNOWN_LIMITATIONS; this is the version that should have existed.
 *
 * Two taps on Android, by design: the platform's date dialog, then its time dialog. Chaining them
 * is more code than a combined picker but it is the pattern every Android user already has muscle
 * memory for, and it means the calendar does the hard part - February, leap years, which Saturday
 * the 4th actually is.
 */
export function DateTimeField({ value, onChange, label, helper, error, minimumDate, maximumDate }: Props) {
  const Picker = loadPicker();
  /** `date` while the day is being chosen, `time` while the clock is, `null` while neither is. */
  const [stage, setStage] = useState<'date' | 'time' | null>(null);
  /** The day the person picked, held between the two dialogs. */
  const [draft, setDraft] = useState<Date | null>(null);
  const [typed, setTyped] = useState('');

  /**
   * Without the native module there is nothing to open, so the typed field comes back.
   *
   * It is the old interaction, but it keeps `checkFutureDateTime`, which names the one thing that is
   * wrong instead of restating every rule - so even the fallback is better than what it replaces.
   */
  if (!Picker) {
    const problem: FieldProblem | null = checkFutureDateTime(typed);
    return (
      <TextField
        label={label}
        helper={helper ?? 'Write it as 2026-10-04 15:30'}
        error={error ?? problem?.message ?? null}
        placeholder="2026-10-04 15:30"
        icon="calendar-outline"
        value={typed}
        onChangeText={(v) => {
          setTyped(v);
          if (checkFutureDateTime(v)) {
            onChange(null);
            return;
          }
          const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(v.trim());
          onChange(m ? new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) : null);
        }}
      />
    );
  }

  const { default: RNPicker } = Picker;
  const floor = minimumDate ?? new Date();

  return (
    <View style={styles.wrap}>
      <Text variant="label" tone="secondary" style={styles.label}>
        {label}
      </Text>

      <Pressable
        onPress={() => {
          setDraft(value ?? null);
          setStage('date');
        }}
        accessibilityRole="button"
        // The value is in the label rather than only on screen, so a screen reader reaching this
        // button says what is currently chosen instead of "button".
        accessibilityLabel={value ? `${label}: ${describe(value)}. Change it` : `Choose ${label.toLowerCase()}`}
        style={({ pressed }) => [styles.box, error && styles.bad, pressed && styles.pressed]}
      >
        <Ionicons name="calendar-outline" size={20} color={error ? palette.danger : palette.textMuted} />
        <Text variant="body" weight={value ? 'semibold' : 'regular'} style={value ? undefined : styles.empty}>
          {value ? describe(value) : 'Pick a day and time'}
        </Text>
        <View style={styles.spacer} />
        <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
      </Pressable>

      {error ? (
        <Text variant="caption" tone="danger" style={styles.helper} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : helper ? (
        <Text variant="caption" tone="muted" style={styles.helper}>
          {helper}
        </Text>
      ) : null}

      {stage === 'date' ? (
        <RNPicker
          value={value ?? floor}
          mode="date"
          minimumDate={floor}
          maximumDate={maximumDate}
          onChange={(_e, picked) => {
            // Dismissing the dialog hands back no date. Leaving the previous value alone is the
            // right answer: cancelling a change is not the same as clearing a booking time.
            if (!picked) {
              setStage(null);
              return;
            }
            setDraft(picked);
            setStage('time');
          }}
        />
      ) : stage === 'time' ? (
        <RNPicker
          value={value ?? draft ?? floor}
          mode="time"
          // 24-hour follows the phone's own setting rather than being forced either way; the label
          // above reads the result back in words, so the dial's format is a preference, not a trap.
          onChange={(_e, picked) => {
            setStage(null);
            if (!picked || !draft) return;
            const merged = new Date(draft);
            merged.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
            onChange(merged);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { marginLeft: spacing.xs },
  box: {
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceMuted,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  bad: { borderColor: palette.danger },
  pressed: { borderColor: palette.primary },
  empty: { color: palette.inputPlaceholder },
  spacer: { flex: 1 },
  helper: { marginLeft: spacing.xs },
});

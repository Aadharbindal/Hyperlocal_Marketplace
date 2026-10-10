import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { palette, spacing } from '@/theme';
import { Button, Card, Text } from '@/ui';

/**
 * The four things a professional has to finish before any work can reach them.
 *
 * The screen used to show a verification card and, below it, an empty state naming one other
 * blocker - so somebody on their first day saw two of four tasks, in two different shapes, with no
 * way to tell how much was left. The feed already receives the whole list: `blockers` is literally
 * what the server is waiting for, so showing it as a list is not new information, it is the
 * information that was already being thrown away.
 *
 * Ticked steps stay on screen rather than disappearing. Three ticks and one empty circle is a
 * different feeling from one instruction, and it is the honest picture: they really have done
 * three things.
 */

/**
 * In the order a person would do them, which is not the order the server happens to return.
 *
 * The order is load-bearing, not cosmetic: the server refuses `isAvailable: true` until
 * verification is through (`verification_pending`), and the switch in the header is disabled to
 * match. Verification sorting first is what keeps "Go online" from ever being offered as the next
 * step while it is still impossible. Skills and base location have no such guard - those really
 * can be done first, they are just a worse order.
 */
const STEPS = [
  {
    key: 'VERIFICATION_PENDING',
    title: 'Get verified',
    done: 'Verified',
    body: 'Submit one ID document so customers know who is coming.',
    action: 'Verify',
    icon: 'shield-checkmark-outline',
  },
  {
    key: 'NO_SKILLS_SELECTED',
    title: 'Pick your services',
    done: 'Services chosen',
    body: 'Choose what you work on so we can match you to the right jobs.',
    action: 'Choose',
    icon: 'construct-outline',
  },
  {
    key: 'NO_BASE_LOCATION',
    title: 'Set where you work from',
    done: 'Location set',
    body: 'Jobs are matched by how far they are from this address.',
    action: 'Set it',
    icon: 'location-outline',
  },
  {
    key: 'AVAILABILITY_OFF',
    title: 'Go online',
    done: 'Online',
    body: 'The switch at the top of this screen. Nothing reaches you while it is off.',

    icon: 'power-outline',
  },
] as const;

export function SetupChecklist({
  blockers,
  onAction,
}: {
  blockers: readonly string[];
  /** Opens the profile, where all three of the actionable steps are done. */
  onAction: () => void;
}) {
  const outstanding = new Set(blockers);
  const doneCount = STEPS.filter((s) => !outstanding.has(s.key)).length;
  /**
   * The first thing left to do, and the only one with a button.
   *
   * Four buttons would be four decisions; there is a correct order here and the screen may as well
   * say so. "Go online" has none deliberately - the switch is already at the top of this screen,
   * and a second control for it would be a second source of truth.
   */
  const next = STEPS.find((s) => outstanding.has(s.key));

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text variant="label" weight="bold" style={styles.flex}>
          Get set up
        </Text>
        <Text variant="micro" tone="muted">
          {`${doneCount} of ${STEPS.length} done`}
        </Text>
      </View>

      {/* A bar rather than only the words: the words are precise and the bar is what gets read at
          a glance, and on this screen the glance is the point. */}
      <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.fill, { width: `${(doneCount / STEPS.length) * 100}%` }]} />
      </View>

      <View style={styles.steps}>
        {STEPS.map((step) => {
          const done = !outstanding.has(step.key);
          const isNext = step.key === next?.key;
          return (
            <View
              key={step.key}
              style={styles.step}
              accessible
              accessibilityLabel={`${done ? 'Done' : 'Still to do'}: ${done ? step.done : step.title}`}
            >
              <Ionicons
                name={done ? 'checkmark-circle' : 'ellipse-outline'}
                size={20}
                color={done ? palette.success : palette.iconFaint}
              />
              <View style={styles.stepText}>
                <Text
                  variant="caption"
                  weight={isNext ? 'semibold' : 'regular'}
                  tone={done ? 'muted' : 'default'}
                  style={done ? styles.doneText : undefined}
                >
                  {done ? step.done : step.title}
                </Text>
                {/* Only the next one explains itself. Four explanations is a wall of text on the
                    screen somebody is trying to get past. */}
                {isNext ? (
                  <Text variant="micro" tone="muted">
                    {step.body}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>

      {next && 'action' in next && next.action ? (
        <Button title={next.action} size="sm" fullWidth icon={next.icon} onPress={onAction} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  track: { height: 6, borderRadius: 3, backgroundColor: palette.surfaceMuted, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: palette.primary },
  steps: { gap: spacing.sm },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  stepText: { flex: 1, gap: 1 },
  doneText: { textDecorationLine: 'line-through' },
});

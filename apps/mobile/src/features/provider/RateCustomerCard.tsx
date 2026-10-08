import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { checkReviewComment, type JobStatus } from '@hyperlocal/core';
import { useLeaveReview } from '@/api/finance';
import { palette, radius, spacing, typography } from '@/theme';
import { Button, Card, Text, TextField } from '@/ui';

const FINISHED: readonly JobStatus[] = ['COMPLETED', 'SETTLED'];

/**
 * The other half of the rating.
 *
 * The server has always allowed a review in both directions - `finance.review` works out the
 * reviewee from who is asking - but the only screen that ever called it was the customer's.
 * So a marketplace that asks people to walk into strangers' homes gave them no way to say
 * anything about it afterwards, and no way to warn the next person.
 *
 * Kept deliberately small and optional. A professional finishing their fourth job of the day
 * does not want a form, and a rating nobody fills in is worse than none because it makes the
 * average meaningless. One tap is the whole interaction; the note is there for the times it
 * matters.
 */
export function RateCustomerCard({ jobId, status, customerName }: { jobId: string; status: JobStatus; customerName?: string | null }) {
  const review = useLeaveReview();
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState('');
  // The next professional reads this before deciding whether to take the job, so it has to say
  // something. Optional, so an empty box is not a problem - only a written one that says nothing is.
  const noteProblem = note.trim() ? checkReviewComment(note) : null;
  const [done, setDone] = useState(false);

  if (!FINISHED.includes(status)) return null;

  if (done) {
    return (
      <Card style={styles.card} tone="soft" flat>
        <View style={styles.row}>
          <Ionicons name="checkmark-circle" size={18} color={palette.success} />
          <Text variant="caption" tone="secondary">
            Thanks - that helps the next person who takes this booking.
          </Text>
        </View>
      </Card>
    );
  }

  async function submit(stars: number) {
    setRating(stars);
    // Sent on the tap rather than behind a second "submit": the rating is the whole point and
    // the note is the optional part, not the other way round.
    try {
      await review.mutateAsync({ jobId, rating: stars, ...(note.trim() ? { comment: note.trim() } : {}) });
      setDone(true);
    } catch {
      // Already reviewed, or the window has closed. Either way there is nothing useful to ask
      // them to do about it.
      setDone(true);
    }
  }

  return (
    <Card style={styles.card} tone="soft" flat>
      <Text variant="caption" weight="semibold">
        How was {customerName ?? 'this customer'}?
      </Text>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            onPress={() => void submit(n)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
            accessibilityState={{ selected: rating >= n }}
          >
            <Ionicons name={rating >= n ? 'star' : 'star-outline'} size={26} color={rating >= n ? palette.gold : palette.textMuted} />
          </Pressable>
        ))}
      </View>
      <TextField
        label="Anything the next professional should know? (optional)"
        value={note}
        onChangeText={setNote}
        placeholder="Access was easy, parking right outside"
        multiline
        minLines={2}
        maxLength={300}
        counter
        accessibilityLabel="A note about this customer"
        error={noteProblem?.message ?? null}
      />
      {note.trim().length > 0 && rating > 0 ? (
        <Button
          title="Send"
          size="sm"
          variant="secondary"
          disabled={!!noteProblem}
          onPress={() => void submit(rating)}
          loading={review.isPending}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stars: { flexDirection: 'row', gap: spacing.sm },
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    color: palette.text,
  },
});

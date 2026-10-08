import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { checkMeaningfulText } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useMaterials, useRequestMaterials } from '@/api/materials';
import { palette, radius, spacing } from '@/theme';
import { Badge, Button, Stepper, Text, TextField } from '@/ui';

interface Row {
  name: string;
  quantity: string;
}

const EMPTY: Row = { name: '', quantity: '1' };

/**
 * What the technician needs, in plain words. The customer picks the supplier and pays for it
 * separately, so this form never mentions a price.
 */
export function MaterialRequestForm({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const panel = useMaterials(jobId, true);
  const request = useRequestMaterials();
  const [rows, setRows] = useState<Row[]>([{ ...EMPTY }]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  /**
   * Item names, checked one at a time.
   *
   * A supplier reads these and quotes against them, so "asdasd" costs somebody a reply they then
   * have to chase. Two characters is the floor on purpose - "6mm", "T", "L bend" are all real
   * answers a plumber would write - so this only refuses what is clearly not an item.
   */
  const rowProblems = rows.map((r) => (r.name.trim() ? checkMeaningfulText(r.name, 2, 'An item name') : null));
  const noteProblem = note.trim() ? checkMeaningfulText(note, 5, 'The note') : null;

  const open = panel.data?.request && (panel.data.request.status === 'OPEN' || panel.data.request.status === 'QUOTED');
  const filled = rows.filter((r) => r.name.trim().length >= 2);

  if (open) {
    return (
      <View style={styles.waiting}>
        <Ionicons name="hourglass-outline" size={16} color={palette.textMuted} />
        <Text variant="caption" tone="muted" style={{ flex: 1 }}>
          Suppliers are sending prices for {panel.data!.request!.items.length} item
          {panel.data!.request!.items.length > 1 ? 's' : ''}. The customer picks one.
        </Text>
        {panel.data!.request!.quoteCount > 0 && <Badge tone="primary" label={`${panel.data!.request!.quoteCount} quoted`} />}
      </View>
    );
  }

  async function submit() {
    setError(null);
    try {
      await request.mutateAsync({
        jobId,
        items: filled.map((r) => ({ name: r.name.trim(), quantity: Math.max(1, Number(r.quantity || 1)), unit: 'PIECE' })),
        note: note.trim() || undefined,
        neededByMinutes: 120,
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? requestError(e) : 'Could not send the request.');
    }
  }

  return (
    <Animated.View entering={FadeInDown.duration(260)} style={styles.form}>
      <Text variant="caption" weight="semibold">
        What do you need?
      </Text>

      {/* One block per item rather than one cramped row.
          The quantity used to be a 62pt numeric text box beside the name, which meant opening a
          keyboard that covers half the screen to turn a 1 into a 2, and let somebody send a
          supplier a request for 999 cartridges by holding a key down. */}
      {rows.map((row, idx) => (
        <View key={idx} style={styles.item}>
          <TextField
            label={`Item ${idx + 1}`}
            value={row.name}
            onChangeText={(v) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, name: v } : r)))}
            placeholder="Brass tap cartridge"
            icon="cube-outline"
            maxLength={80}
            error={rowProblems[idx]?.message ?? null}
          />
          <View style={styles.qtyRow}>
            <Stepper
              label={row.name.trim() ? `Quantity for ${row.name.trim()}` : `Quantity for item ${idx + 1}`}
              value={Math.max(1, Number(row.quantity || 1))}
              onChange={(n) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, quantity: String(n) } : r)))}
              min={1}
              max={99}
              unit="pcs"
            />
            <View style={styles.spacer} />
            {rows.length > 1 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={row.name.trim() ? `Remove ${row.name.trim()}` : `Remove item ${idx + 1}`}
                hitSlop={8}
                onPress={() => setRows((rs) => rs.filter((_, i) => i !== idx))}
                style={styles.removeBtn}
              >
                <Ionicons name="trash-outline" size={17} color={palette.danger} />
              </Pressable>
            )}
          </View>
        </View>
      ))}

      {rows.length < 6 && (
        <Pressable accessibilityRole="button" onPress={() => setRows((rs) => [...rs, { ...EMPTY }])} style={styles.addRow}>
          <Ionicons name="add-circle-outline" size={16} color={palette.primaryDeep} />
          <Text variant="caption" weight="semibold" tone="primary">
            Add another item
          </Text>
        </Pressable>
      )}

      <TextField
        label="Note for the supplier (optional)"
        value={note}
        onChangeText={setNote}
        placeholder="Needs to fit a 15mm pipe"
        icon="chatbubble-ellipses-outline"
        multiline
        minLines={2}
        maxLength={200}
        counter
        error={noteProblem?.message ?? null}
      />

      {error && (
        <Text variant="micro" tone="danger">
          {error}
        </Text>
      )}

      <View style={styles.actions}>
        <Button title="Cancel" size="sm" variant="ghost" style={styles.action} onPress={onDone} />
        <Button
          title="Ask suppliers"
          size="sm"
          style={styles.action}
          disabled={rowProblems.some((p) => p) || !!noteProblem}
          loading={request.isPending}
          onPress={submit}
        />
      </View>
      <Text variant="micro" tone="muted">
        The customer approves and pays for materials separately. Your job price does not change.
      </Text>
    </Animated.View>
  );
}

function requestError(e: ApiError): string {
  const first = (e.details as { materials?: string[] } | undefined)?.materials?.[0];
  switch (first) {
    case 'CUSTOMER_SUPPLIES_MATERIAL':
      return 'This customer is supplying the materials themselves.';
    case 'REQUEST_ALREADY_OPEN':
      return 'You already have a material request open on this job.';
    case 'REQUEST_LIMIT_REACHED':
      return 'You have already asked three times on this job.';
    case 'JOB_NOT_ON_SITE':
      return 'You can ask for materials once you have started the work.';
    case 'NO_ITEMS':
      return 'Add at least one item.';
    default:
      return e.message;
  }
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  item: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSunken,
    borderWidth: 1,
    borderColor: palette.borderSoft,
  },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  spacer: { flex: 1 },
  removeBtn: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});

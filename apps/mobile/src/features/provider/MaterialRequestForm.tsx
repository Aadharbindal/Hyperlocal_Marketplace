import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { checkMeaningfulText } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useMaterials, useRequestMaterials } from '@/api/materials';
import { palette, radius, spacing, typography } from '@/theme';
import { Badge, Button, Text } from '@/ui';

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

      {rows.map((row, idx) => (
        <View key={idx} style={styles.row}>
          <TextInput
            value={row.name}
            onChangeText={(v) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, name: v } : r)))}
            placeholder="e.g. brass tap cartridge"
            placeholderTextColor="#A9B8B1"
            style={[styles.input, { flex: 1 }, rowProblems[idx] && styles.inputBad]}
            accessibilityLabel={`Item ${idx + 1}`}
          />
          <TextInput
            value={row.quantity}
            onChangeText={(v) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, quantity: v.replace(/\D/g, '').slice(0, 3) } : r)))}
            keyboardType="number-pad"
            style={[styles.input, styles.qty]}
            accessibilityLabel={`Quantity for item ${idx + 1}`}
          />
          {rows.length > 1 && (
            <Pressable accessibilityRole="button" accessibilityLabel="Remove item" hitSlop={8} onPress={() => setRows((rs) => rs.filter((_, i) => i !== idx))}>
              <Ionicons name="close-circle" size={20} color="#C2CEC9" />
            </Pressable>
          )}
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

      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Anything the supplier should know"
        placeholderTextColor="#A9B8B1"
        style={[styles.input, noteProblem && styles.inputBad]}
        accessibilityLabel="Note for the supplier"
      />
      {noteProblem ? (
        <Text variant="micro" style={{ color: palette.danger }}>
          {noteProblem.message}
        </Text>
      ) : null}
      {rowProblems.find((p) => p) ? (
        <Text variant="micro" style={{ color: palette.danger }}>
          {rowProblems.find((p) => p)!.message}
        </Text>
      ) : null}

      {error && (
        <Text variant="micro" style={{ color: palette.danger }}>
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
  form: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#E4EDE9',
    paddingHorizontal: spacing.md,
    fontSize: 15,
    fontFamily: typography.family.regular,
    color: palette.text,
  },
  inputBad: { borderColor: palette.danger },
  qty: { width: 62, textAlign: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});

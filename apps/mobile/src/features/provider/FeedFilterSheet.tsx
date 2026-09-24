import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { FEED_SORTS, type FeedFacetsView, type FeedFilters, type FeedSort } from '@hyperlocal/core';
import { palette, radius, spacing } from '@/theme';
import { Button, Spacer, Text } from '@/ui';

/**
 * Narrowing the feed.
 *
 * The options are built from what is actually in this provider's feed today, not from the whole
 * catalog: a filter for a category with nothing in it is a dead end somebody has to discover by
 * tapping it. Each one carries its count, so the choice is made with the answer already visible.
 */

const SORT_LABEL: Record<FeedSort, string> = {
  NEAREST: 'Nearest first',
  NEWEST: 'Just posted',
  BIGGEST: 'Biggest jobs',
  FEWEST_BIDS: 'Least competition',
  SOONEST: 'Needed soonest',
};

const DISTANCES = [2, 5, 10, 20];

export function FeedFilterSheet({
  visible,
  onClose,
  filters,
  facets,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  filters: FeedFilters;
  facets?: FeedFacetsView;
  onApply: (next: FeedFilters) => void;
}) {
  const [draft, setDraft] = useState<FeedFilters>(filters);

  // The sheet edits a copy: closing it without applying leaves the feed exactly as it was.
  function open() {
    setDraft(filters);
  }

  function toggleCategory(id: string) {
    const current = draft.categoryIds ?? [];
    const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
    setDraft({ ...draft, categoryIds: next.length ? next : undefined });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onShow={open}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close filters" />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <View style={styles.headerRow}>
          <Text variant="label" weight="bold" style={{ flex: 1 }}>
            Filter jobs
          </Text>
          <Pressable onPress={() => setDraft({})} accessibilityRole="button" hitSlop={8}>
            <Text variant="micro" style={{ color: palette.primary }}>
              Clear all
            </Text>
          </Pressable>
        </View>

        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          <Section title="Sort by">
            <View style={styles.chips}>
              {FEED_SORTS.map((s) => (
                <Chip
                  key={s}
                  label={SORT_LABEL[s]}
                  selected={(draft.sort ?? 'NEAREST') === s}
                  onPress={() => setDraft({ ...draft, sort: s })}
                />
              ))}
            </View>
          </Section>

          {facets?.categories.length ? (
            <Section title="Trade">
              <View style={styles.chips}>
                {facets.categories.map((c) => (
                  <Chip
                    key={c.id}
                    // The count is on the chip so the choice is made with the answer visible.
                    label={`${c.name} (${c.count})`}
                    selected={!!draft.categoryIds?.includes(c.id)}
                    onPress={() => toggleCategory(c.id)}
                  />
                ))}
              </View>
            </Section>
          ) : null}

          <Section title="How far you will travel">
            <View style={styles.chips}>
              {DISTANCES.filter((km) => !facets || km <= Math.ceil(facets.furthestKm) + 5).map((km) => (
                <Chip
                  key={km}
                  label={`${km} km`}
                  selected={draft.maxDistanceKm === km}
                  onPress={() => setDraft({ ...draft, maxDistanceKm: draft.maxDistanceKm === km ? undefined : km })}
                />
              ))}
            </View>
          </Section>

          <Section title="Competition">
            <View style={styles.chips}>
              {[0, 2, 5].map((n) => (
                <Chip
                  key={n}
                  label={n === 0 ? 'No bids yet' : `Under ${n + 1} bids`}
                  selected={draft.maxBids === n}
                  onPress={() => setDraft({ ...draft, maxBids: draft.maxBids === n ? undefined : n })}
                />
              ))}
            </View>
          </Section>

          <Toggle
            label="Hide jobs I have bid on"
            hint="Once you have sent an offer, there is nothing more to do until they answer."
            value={!!draft.hideMyBids}
            onChange={(hideMyBids) => setDraft({ ...draft, hideMyBids: hideMyBids || undefined })}
          />
          <Toggle
            label="Only jobs with photos"
            hint="A job you can see is a job you can price honestly."
            value={!!draft.withMediaOnly}
            onChange={(withMediaOnly) => setDraft({ ...draft, withMediaOnly: withMediaOnly || undefined })}
            last
          />
          <Spacer h={spacing.md} />
        </ScrollView>

        <Button
          title={facets ? `Show jobs` : 'Apply'}
          fullWidth
          onPress={() => {
            onApply(draft);
            onClose();
          }}
        />
        <Spacer h={Platform.OS === 'ios' ? spacing.lg : spacing.sm} />
      </View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="micro" tone="muted" weight="semibold">
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipOn]}
    >
      {selected ? <Ionicons name="checkmark" size={14} color={palette.textOnPrimary} /> : null}
      <Text variant="micro" weight="semibold" style={{ color: selected ? palette.textOnPrimary : palette.primaryDeep }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
  last,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <View style={[styles.toggle, !last && styles.toggleDivider]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" weight="semibold">
          {label}
        </Text>
        <Text variant="micro" tone="muted">
          {hint}
        </Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: palette.primary, false: '#D9E4E0' }} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(12, 32, 26, 0.45)' },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: '82%',
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D9E4E0', marginBottom: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  body: { flexGrow: 0 },
  section: { gap: spacing.sm, marginBottom: spacing.lg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: '#E8F6F1',
  },
  chipOn: { backgroundColor: palette.primary },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  toggleDivider: { borderBottomWidth: 1, borderBottomColor: '#EEF4F2' },
});

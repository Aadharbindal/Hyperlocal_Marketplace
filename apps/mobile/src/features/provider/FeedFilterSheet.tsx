import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { FEED_SORTS, type FeedFacetsView, type FeedFilters, type FeedSort } from '@hyperlocal/core';
import { palette, radius, spacing } from '@/theme';
import { Button, ChipMultiSelect, SegmentedControl, Spacer, Text } from '@/ui';

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
            <SegmentedControl
              label="Sort by"
              options={FEED_SORTS.map((s) => ({ value: s, label: SORT_LABEL[s] }))}
              value={draft.sort ?? 'NEAREST'}
              onChange={(sort) => setDraft({ ...draft, sort })}
            />
          </Section>

          {facets?.categories.length ? (
            <Section title="Trade">
              {/* Checkboxes: picking plumbing does not unpick electrical. The old chips said
                  "button" to a screen reader, so which ones were already on was invisible. */}
              <ChipMultiSelect
                label="Trade"
                options={facets.categories.map((c) => ({
                  value: c.id,
                  // The count is on the chip so the choice is made with the answer visible.
                  label: `${c.name} (${c.count})`,
                }))}
                value={draft.categoryIds ?? []}
                onToggle={toggleCategory}
              />
            </Section>
          ) : null}

          {/* These two were chips you tapped a second time to clear, which is an interaction nobody
              discovers - so a provider who set 3 km had no visible way back to "any distance". An
              explicit option for it costs one chip and removes the guessing. */}
          <Section title="How far you will travel">
            <SegmentedControl
              label="How far you will travel"
              options={[
                { value: 'any', label: 'Any distance' },
                ...DISTANCES.filter((km) => !facets || km <= Math.ceil(facets.furthestKm) + 5).map((km) => ({
                  value: String(km),
                  label: `${km} km`,
                })),
              ]}
              value={draft.maxDistanceKm ? String(draft.maxDistanceKm) : 'any'}
              onChange={(v) => setDraft({ ...draft, maxDistanceKm: v === 'any' ? undefined : Number(v) })}
            />
          </Section>

          <Section title="Competition">
            <SegmentedControl
              label="Competition"
              options={[
                { value: 'any', label: 'Any' },
                ...[0, 2, 5].map((n) => ({
                  value: String(n),
                  label: n === 0 ? 'No bids yet' : `Under ${n + 1} bids`,
                })),
              ]}
              value={draft.maxBids === undefined ? 'any' : String(draft.maxBids)}
              onChange={(v) => setDraft({ ...draft, maxBids: v === 'any' ? undefined : Number(v) })}
            />
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
      <Switch value={value} onValueChange={onChange} trackColor={{ true: palette.primary, false: palette.borderStrong }} accessibilityLabel={label} />
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
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: palette.borderStrong, marginBottom: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  body: { flexGrow: 0 },
  section: { gap: spacing.sm, marginBottom: spacing.lg },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  toggleDivider: { borderBottomWidth: 1, borderBottomColor: palette.borderSoft },
});

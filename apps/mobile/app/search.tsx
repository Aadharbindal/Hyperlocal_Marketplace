import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSearch } from '@/api/warranty';
import { useStrings } from '@/i18n';
import { palette, radius, spacing } from '@/theme';
import { Card, Screen, Spacer, Text } from '@/ui';

/**
 * The search box that has been a stub since M2.
 *
 * Two things it gets right that a naive one would not: it never shows a blank panel (a search
 * that shows nothing before you type reads as broken, so it offers what you booked before), and
 * it says what a result matched on - so somebody who typed "gizer" and got "Water heater"
 * understands why rather than assuming the app is confused.
 */
export default function SearchScreen() {
  const router = useRouter();
  const t = useStrings();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const input = useRef<TextInput>(null);

  // Debounced, because this fires on every keystroke and the answer should feel instant without
  // asking the server about every half-typed word.
  useEffect(() => {
    const id = setTimeout(() => setQuery(text.trim()), 220);
    return () => clearTimeout(id);
  }, [text]);

  useEffect(() => {
    const id = setTimeout(() => input.current?.focus(), 250);
    return () => clearTimeout(id);
  }, []);

  const results = useSearch(query);
  const showing = query.length >= 2 ? (results.data?.hits ?? []) : [];
  const suggestions = results.data?.suggestions ?? [];

  function book(categoryId: string, skillId?: string | null) {
    router.push({
      pathname: '/(customer)/book',
      params: { categoryId, ...(skillId ? { skillId } : {}) },
    });
  }

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={palette.text} />
        </Pressable>
        <View style={styles.field}>
          <Ionicons name="search-outline" size={18} color={palette.textMuted} />
          <TextInput
            ref={input}
            value={text}
            onChangeText={setText}
            placeholder={t('home.search')}
            placeholderTextColor={palette.textMuted}
            style={styles.input}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search for a service"
          />
          {text.length > 0 ? (
            <Pressable onPress={() => setText('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear">
              <Ionicons name="close-circle" size={18} color={palette.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <Spacer h={spacing.lg} />

      {query.length >= 2 && showing.length === 0 && !results.isPending ? (
        <Card style={{ gap: 4 }}>
          <Text variant="label" weight="semibold">
            Nothing matches &ldquo;{query}&rdquo;
          </Text>
          <Text variant="micro" tone="muted">
            Try the thing that is broken - &ldquo;geyser&rdquo;, &ldquo;fan&rdquo;, &ldquo;नल&rdquo; - or pick a trade below.
          </Text>
        </Card>
      ) : null}

      {showing.length > 0 ? (
        <View style={styles.list}>
          {showing.map((hit) => (
            <Pressable
              key={`${hit.categoryId}:${hit.skillId ?? ''}`}
              onPress={() => book(hit.categoryId, hit.skillId)}
              accessibilityRole="button"
            >
              <Card style={styles.row}>
                <Ionicons name={hit.skillId ? 'build-outline' : 'grid-outline'} size={18} color={palette.primary} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="label" weight="semibold">
                    {hit.label}
                  </Text>
                  <Text variant="micro" tone="muted">
                    {hit.categoryName}
                    {/* Said out loud, so "gizer" finding "Water heater" explains itself. */}
                    {hit.matchedOn.toLowerCase() !== hit.label.toLowerCase() ? ` · matched “${hit.matchedOn}”` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
              </Card>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Never a blank panel. */}
      {query.length < 2 && suggestions.length > 0 ? (
        <>
          <Text weight="semibold" style={styles.section}>
            {suggestions[0]?.reason === 'RECENT' ? 'Book again' : 'Popular near you'}
          </Text>
          <View style={styles.list}>
            {suggestions.map((s) => (
              <Pressable key={s.categoryId} onPress={() => book(s.categoryId)} accessibilityRole="button">
                <Card style={styles.row}>
                  <Ionicons
                    name={s.reason === 'RECENT' ? 'time-outline' : 'flame-outline'}
                    size={18}
                    color={palette.textMuted}
                  />
                  <Text variant="label" weight="semibold" style={{ flex: 1 }}>
                    {s.label}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
                </Card>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    height: 46,
  },
  input: { flex: 1, color: palette.text, fontSize: 15, padding: 0 },
  section: { fontSize: 14, marginBottom: spacing.sm },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});

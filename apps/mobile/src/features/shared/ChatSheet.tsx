import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { CHAT_MESSAGE_MAX } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useChat, useSendMessage } from '@/api/execution';
import { palette, radius, spacing, typography } from '@/theme';
import { Text } from '@/ui';

/**
 * In-job chat. It exists so the two sides can sort out access and details without swapping
 * phone numbers - messages that contain contact details are flagged for review.
 */
export function ChatSheet({ jobId, visible, onClose }: { jobId: string; visible: boolean; onClose: () => void }) {
  const thread = useChat(jobId, visible);
  const send = useSendMessage();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    setError(null);
    try {
      await send.mutateAsync({ jobId, body });
      setDraft('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Message not sent.');
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close chat" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.lift}>
        <Animated.View entering={FadeInDown.duration(260)} style={styles.sheet}>
          <View style={styles.grabber} />
          <Text weight="bold" style={styles.title}>
            Messages
          </Text>

          <ScrollView style={styles.list} contentContainerStyle={styles.listInner} showsVerticalScrollIndicator={false}>
            {thread.data?.items.length ? (
              thread.data.items.map((m) => (
                <View key={m.id} style={[styles.bubble, m.mine ? styles.mine : styles.theirs]}>
                  {!m.mine && (
                    <Text variant="micro" tone="muted">
                      {m.senderName}
                    </Text>
                  )}
                  <Text variant="caption" style={m.mine ? styles.mineText : undefined}>
                    {m.body}
                  </Text>
                  {m.flagged && (
                    <View style={styles.flag}>
                      <Ionicons name="alert-circle-outline" size={12} color={palette.danger} />
                      <Text variant="micro" style={{ color: palette.danger }}>
                        Flagged: keep payments and contact on LocalHub
                      </Text>
                    </View>
                  )}
                </View>
              ))
            ) : (
              <Text variant="caption" tone="muted" center style={{ marginTop: spacing.xl }}>
                No messages yet. Ask about access, parking or timing here.
              </Text>
            )}
          </ScrollView>

          {thread.data && !thread.data.open && (
            <Text variant="micro" tone="muted" center>
              This job is closed, so the chat is read-only.
            </Text>
          )}

          {error && (
            <Text variant="micro" center style={{ color: palette.danger }}>
              {error}
            </Text>
          )}

          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              editable={thread.data?.open !== false}
              placeholder="Type a message"
              placeholderTextColor="#A9B8B1"
              maxLength={CHAT_MESSAGE_MAX}
              multiline
              style={styles.input}
              accessibilityLabel="Message"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send"
              onPress={submit}
              disabled={send.isPending || !draft.trim()}
              style={[styles.sendBtn, (!draft.trim() || send.isPending) && styles.sendOff]}
            >
              <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: palette.overlay },
  lift: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    maxHeight: '86%',
    gap: spacing.sm,
  },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: palette.border, marginBottom: spacing.sm },
  title: { fontSize: 18, color: palette.text },
  list: { maxHeight: 360 },
  listInner: { gap: spacing.sm, paddingVertical: spacing.sm },
  bubble: { maxWidth: '86%', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 2 },
  mine: { alignSelf: 'flex-end', backgroundColor: palette.primary },
  mineText: { color: '#FFFFFF' },
  theirs: { alignSelf: 'flex-start', backgroundColor: '#F1F6F4' },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 110,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#E4EDE9',
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    fontSize: 15,
    fontFamily: typography.family.regular,
    color: palette.text,
  },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: palette.primary, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.45 },
});

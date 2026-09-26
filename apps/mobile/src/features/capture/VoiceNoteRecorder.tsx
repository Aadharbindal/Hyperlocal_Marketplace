import { Ionicons } from '@expo/vector-icons';
import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import type { LocalMedia } from '@/api/jobs';
import { palette, radius, spacing } from '@/theme';
import { Text } from '@/ui';

/**
 * A short spoken description of the problem.
 *
 * This exists because typing a paragraph in a second language on a phone is work, and
 * describing a broken geyser out loud is not. A customer who cannot easily write still deserves
 * to be understood by the person quoting - and a provider reading "पानी टपक रहा है, नीचे वाले
 * फ्लैट में भी" in the customer's own voice prices it better than one reading "leak".
 *
 * Sixty seconds, because the server enforces sixty seconds. The countdown is shown from the
 * start rather than cutting somebody off mid-sentence at the limit.
 */

export const MAX_VOICE_NOTE_SECONDS = 60;

/**
 * Spelled out rather than taken from `RecordingPresets`, which is typed as an open record and
 * so could silently be undefined. These are the low-quality values: this is a voice on a phone,
 * and a provider on a patchy connection has to be able to play it back. A minute lands at
 * roughly half a megabyte instead of five.
 */
const PRESET: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 22_050,
  numberOfChannels: 1,
  bitRate: 64_000,
  android: { extension: '.m4a', outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { audioQuality: AudioQuality.LOW, outputFormat: IOSOutputFormat.MPEG4AAC, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
  web: { mimeType: 'audio/webm', bitsPerSecond: 64_000 },
};

export function VoiceNoteRecorder({
  existing,
  onRecorded,
  onRemove,
  disabled,
}: {
  /** Set once a note is attached, so the control becomes a "remove" rather than a "record". */
  existing?: { id: string; durationSeconds: number | null } | null;
  onRecorded: (file: LocalMedia) => void;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  const recorder = useAudioRecorder(PRESET);
  const state = useAudioRecorderState(recorder, 250);
  const [busy, setBusy] = useState(false);
  const seconds = Math.floor(state.durationMillis / 1000);

  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = state.isRecording
      ? withRepeat(withTiming(1, { duration: 1200, easing: Easing.out(Easing.ease) }), -1, false)
      : 0;
  }, [state.isRecording, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.7 }],
    opacity: 0.35 * (1 - pulse.value),
  }));

  // Stopped automatically at the limit rather than refused afterwards: losing a minute of
  // somebody's explanation because they ran two seconds over would be unforgivable.
  const atLimit = state.isRecording && seconds >= MAX_VOICE_NOTE_SECONDS;
  useEffect(() => {
    if (atLimit) void stopRef.current();
  }, [atLimit]);

  async function start() {
    if (disabled || busy) return;
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Microphone access is off',
        permission.canAskAgain ? 'Allow the microphone to record a voice note.' : 'Turn it back on in Settings, under this app.',
        permission.canAskAgain
          ? [{ text: 'OK' }]
          : [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open Settings', onPress: () => void Linking.openSettings() },
            ],
      );
      return;
    }
    setBusy(true);
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      Alert.alert('Could not start recording', 'Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  // Held in a ref so the effect above depends only on "we hit the limit", not on a function
  // that is a new one on every render.
  const stopRef = useRef<() => Promise<void>>(async () => {});
  stopRef.current = stop;

  async function stop() {
    setBusy(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) return;
      const length = Math.max(1, Math.min(seconds, MAX_VOICE_NOTE_SECONDS));
      onRecorded({
        uri,
        kind: 'VOICE_NOTE',
        mime: 'audio/m4a',
        // Roughly what LOW_QUALITY produces per second. The server measures the real thing.
        sizeBytes: length * 8_000,
        durationSeconds: length,
      });
    } catch {
      Alert.alert('Could not save that recording', 'Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  if (existing) {
    return (
      <View style={styles.attached}>
        <Ionicons name="mic" size={18} color={palette.primary} />
        <Text variant="caption" weight="semibold" style={{ flex: 1 }}>
          Voice note attached{existing.durationSeconds ? ` · ${existing.durationSeconds}s` : ''}
        </Text>
        {onRemove ? (
          <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel="Remove voice note">
            <Ionicons name="close-circle" size={20} color={palette.textMuted} />
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => void (state.isRecording ? stop() : start())}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={state.isRecording ? 'Stop recording' : 'Record a voice note'}
      style={[styles.control, state.isRecording && styles.controlLive]}
    >
      <View style={styles.micWrap}>
        {state.isRecording ? <Animated.View style={[styles.pulse, pulseStyle]} /> : null}
        <Ionicons
          name={state.isRecording ? 'stop' : 'mic-outline'}
          size={20}
          color={state.isRecording ? palette.textOnPrimary : palette.primary}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="caption" weight="semibold" style={state.isRecording ? { color: palette.textOnPrimary } : undefined}>
          {state.isRecording ? 'Recording… tap to stop' : 'Say what the problem is'}
        </Text>
        <Text variant="micro" style={state.isRecording ? { color: palette.textOnPrimaryMuted } : { color: palette.textMuted }}>
          {state.isRecording
            ? `${seconds}s · ${MAX_VOICE_NOTE_SECONDS - seconds}s left`
            : `Up to ${MAX_VOICE_NOTE_SECONDS} seconds. Easier than typing it out.`}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#F6FBF9',
  },
  controlLive: { backgroundColor: palette.primary },
  micWrap: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  pulse: { position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFFFFF' },
  attached: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#E8F6F1',
  },
});

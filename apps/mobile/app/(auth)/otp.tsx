import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { maskPhone } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useRequestOtp, useVerifyOtp } from '@/api/hooks';
import { useStrings } from '@/i18n';
import { useNetwork } from '@/store/network';
import { palette, radius, spacing } from '@/theme';
import { OfflineBanner, Text } from '@/ui';

const LENGTH = 6;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** One OTP digit box - lifts and glows as it is filled. */
function DigitBox({ char, active, error }: { char: string; active: boolean; error: boolean }) {
  const scale = useSharedValue(1);
  useEffect(() => {
    if (char) scale.value = withSequence(withSpring(1.12, { damping: 10, stiffness: 400 }), withSpring(1, { damping: 14 }));
  }, [char, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={[styles.box, char && styles.boxFilled, active && styles.boxActive, error && styles.boxError, style]}>
      <Text weight="bold" style={styles.boxText}>
        {char}
      </Text>
    </Animated.View>
  );
}

export default function OtpScreen() {
  const t = useStrings();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const online = useNetwork((s) => s.online);
  const params = useLocalSearchParams<{ phone: string; challengeId: string; expires: string; demoCode?: string }>();
  const [challengeId, setChallengeId] = useState(params.challengeId);
  const [demoCode, setDemoCode] = useState(params.demoCode || '');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(60);
  const input = useRef<TextInput>(null);
  const verify = useVerifyOtp();
  const resend = useRequestOtp();

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // pulsing ring behind the badge
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.ease) }), -1, false);
  }, [pulse]);
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pulse.value * 0.5 }], opacity: 0.28 * (1 - pulse.value) }));

  const shake = useSharedValue(0);
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const shakeRow = () =>
    (shake.value = withSequence(
      withTiming(-9, { duration: 55 }),
      withTiming(9, { duration: 55 }),
      withTiming(-5, { duration: 55 }),
      withTiming(0, { duration: 55 }),
    ));

  const ctaScale = useSharedValue(1);
  const ctaStyle = useAnimatedStyle(() => ({ transform: [{ scale: ctaScale.value }] }));

  const submit = async (value = code) => {
    if (value.length !== LENGTH) return;
    setError(null);
    try {
      await verify.mutateAsync({ challengeId, code: value });
      // AuthGate routes onward once /me resolves.
    } catch (err) {
      if (err instanceof ApiError) {
        const remaining = (err.details as { attemptsRemaining?: number } | undefined)?.attemptsRemaining;
        setError(remaining !== undefined ? `${err.message} (${remaining} left)` : err.message);
        if (err.code === 'OTP_LOCKED' || err.code === 'OTP_EXPIRED' || err.code === 'OTP_CONSUMED') setCooldown(0);
      } else setError(t('common.error'));
      shakeRow();
      setCode('');
    }
  };

  const onResend = async () => {
    try {
      const res = await resend.mutateAsync(params.phone);
      setChallengeId(res.challengeId);
      setDemoCode(res.demoCode ?? '');
      setCooldown(res.resendAfterSeconds);
      setError(null);
      setCode('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  };

  return (
    <LinearGradient colors={['#FFFFFF', '#FBFDFD', '#F4FDFA', '#EAF8F1']} locations={[0, 0.35, 0.72, 1]} style={styles.root}>
      <StatusBar style="dark" />
      <View style={{ paddingTop: insets.top }}>
        <OfflineBanner visible={!online} label={t('error.OFFLINE')} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Animated.View entering={FadeInDown.duration(420)}>
            <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.back}>
              <Ionicons name="arrow-back" size={22} color="#16241F" />
            </Pressable>
          </Animated.View>

          {/* badge */}
          <Animated.View entering={FadeIn.delay(100).duration(600)} style={styles.badgeWrap}>
            <Animated.View style={[styles.ring, ringStyle]} pointerEvents="none" />
            <LinearGradient colors={['#1BA87E', '#0A6A51']} start={{ x: 0.2, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.badge}>
              <LinearGradient colors={['rgba(255,255,255,0.45)', 'rgba(255,255,255,0)']} style={styles.badgeGloss} />
              <Ionicons name="chatbubble-ellipses" size={34} color="#FFFFFF" />
            </LinearGradient>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(160).duration(520)}>
            <Text weight="extrabold" style={styles.title}>
              Verify your number
            </Text>
            <Text style={styles.subtitle}>
              We sent a 6-digit code to{' '}
              <Text weight="semibold" style={styles.phone}>
                {maskPhone(params.phone)}
              </Text>
            </Text>
            <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8} style={styles.changeRow}>
              <Ionicons name="create-outline" size={15} color={palette.primary} />
              <Text weight="semibold" style={styles.change}>
                Change number
              </Text>
            </Pressable>
          </Animated.View>

          {/* code entry */}
          <Animated.View entering={FadeInDown.delay(240).duration(520)} style={styles.card}>
            <Pressable onPress={() => input.current?.focus()} accessibilityLabel="One-time code">
              <Animated.View style={[styles.boxes, rowStyle]}>
                {Array.from({ length: LENGTH }).map((_, i) => (
                  <DigitBox key={i} char={code[i] ?? ''} active={i === code.length} error={!!error} />
                ))}
              </Animated.View>
              <TextInput
                ref={input}
                value={code}
                onChangeText={(v) => {
                  const digits = v.replace(/\D/g, '').slice(0, LENGTH);
                  setCode(digits);
                  if (error) setError(null);
                  if (digits.length === LENGTH) void submit(digits);
                }}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                autoFocus
                maxLength={LENGTH}
                style={styles.hidden}
                caretHidden
              />
            </Pressable>

            {error ? (
              <Animated.View entering={FadeIn.duration(200)} style={styles.noteRow}>
                <Ionicons name="alert-circle" size={15} color={palette.danger} />
                <Text style={[styles.note, { color: palette.danger }]}>{error}</Text>
              </Animated.View>
            ) : demoCode ? (
              <View style={styles.demo}>
                <Ionicons name="flask-outline" size={14} color="#8A6400" />
                <Text weight="semibold" style={styles.demoText}>
                  Demo mode: your code is {demoCode}
                </Text>
              </View>
            ) : (
              <View style={styles.noteRow}>
                <Ionicons name="time-outline" size={15} color="#93A69E" />
                <Text style={styles.note}>The code expires in 5 minutes</Text>
              </View>
            )}

            <AnimatedPressable
              accessibilityRole="button"
              accessibilityState={{ disabled: code.length !== LENGTH, busy: verify.isPending }}
              disabled={code.length !== LENGTH || verify.isPending}
              onPressIn={() => (ctaScale.value = withSpring(0.97, { damping: 18, stiffness: 320 }))}
              onPressOut={() => (ctaScale.value = withSpring(1, { damping: 14, stiffness: 260 }))}
              onPress={() => submit()}
              style={[styles.ctaWrap, ctaStyle, code.length !== LENGTH && styles.ctaDisabled]}
            >
              <LinearGradient colors={['#12886A', '#0A6A51']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cta}>
                <LinearGradient colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']} style={styles.ctaGloss} />
                <Text weight="bold" style={styles.ctaText}>
                  {verify.isPending ? 'Verifying…' : 'Verify & Continue'}
                </Text>
                {!verify.isPending && <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />}
              </LinearGradient>
            </AnimatedPressable>

            <View style={styles.resendRow}>
              {cooldown > 0 ? (
                <Text style={styles.note}>
                  Didn&apos;t get it? Resend in{' '}
                  <Text weight="semibold" style={styles.timer}>
                    0:{String(cooldown).padStart(2, '0')}
                  </Text>
                </Text>
              ) : (
                <Pressable accessibilityRole="button" onPress={onResend} hitSlop={8} style={styles.changeRow}>
                  <Ionicons name="refresh" size={15} color={palette.primary} />
                  <Text weight="semibold" style={styles.change}>
                    {resend.isPending ? 'Sending…' : 'Resend code'}
                  </Text>
                </Pressable>
              )}
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.screen, paddingTop: spacing.md, paddingBottom: spacing.xxl },

  back: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#0B3F30', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },

  badgeWrap: { alignItems: 'center', marginTop: spacing.xxl },
  ring: { position: 'absolute', width: 84, height: 84, borderRadius: 42, backgroundColor: palette.primary },
  badge: {
    width: 84,
    height: 84,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0B6F55',
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  badgeGloss: { position: 'absolute', top: 0, left: 0, right: 0, height: 40, borderTopLeftRadius: 28, borderTopRightRadius: 28 },

  title: { fontSize: 27, lineHeight: 34, color: '#0B1512', letterSpacing: -0.7, textAlign: 'center', marginTop: spacing.xl },
  subtitle: { fontSize: 14, lineHeight: 21, color: '#788B84', textAlign: 'center', marginTop: spacing.xs },
  phone: { color: '#16241F' },
  changeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: spacing.sm, minHeight: 36 },
  change: { fontSize: 13.5, color: palette.primary },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 26,
    padding: spacing.xl,
    marginTop: spacing.xl,
    shadowColor: '#0B3F30',
    shadowOpacity: 0.1,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  boxes: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  box: { flex: 1, height: 58, borderRadius: 15, backgroundColor: '#F3F8F6', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  boxFilled: { backgroundColor: '#FFFFFF', borderColor: '#BFE5D6' },
  boxActive: { borderColor: palette.primary, backgroundColor: '#FFFFFF' },
  boxError: { borderColor: palette.danger },
  boxText: { fontSize: 22, lineHeight: 28, color: '#0F1D18' },
  hidden: { position: 'absolute', opacity: 0, width: 1, height: 1 },

  noteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.lg },
  note: { fontSize: 12.5, color: '#93A69E', textAlign: 'center' },
  timer: { color: '#16241F' },
  demo: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6, marginTop: spacing.lg, backgroundColor: '#FFF3D4', paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill },
  demoText: { fontSize: 12.5, color: '#8A6400' },

  ctaWrap: { marginTop: spacing.xl, borderRadius: radius.pill, shadowColor: '#0A6A51', shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  ctaDisabled: { opacity: 0.45, shadowOpacity: 0 },
  cta: { height: 58, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, overflow: 'hidden' },
  ctaGloss: { position: 'absolute', top: 0, left: 0, right: 0, height: 26 },
  ctaText: { fontSize: 16, color: '#FFFFFF' },
  resendRow: { alignItems: 'center', marginTop: spacing.lg },
});

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInLeft,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { normaliseIndianPhone } from '@hyperlocal/core';
import { ApiError } from '@/api/client';
import { useRequestOtp } from '@/api/hooks';
import { useStrings } from '@/i18n';
import { useNetwork } from '@/store/network';
import { BRAND } from '@/theme/brand';
import { palette, radius, spacing, typography } from '@/theme';
import { OfflineBanner, Text } from '@/ui';
import HERO from '../../assets/hero-technician.png';

const HERO_RATIO = 894 / 828; // natural size of the artwork

interface Feature {
  icon?: keyof typeof Ionicons.glyphMap;
  glyph?: string;
  from: string;
  to: string;
  fg: string;
  title: string;
  body: string;
}

const FEATURES: Feature[] = [
  { icon: 'shield-checkmark', from: '#E6F7EF', to: '#C8EBDC', fg: '#0E8A6A', title: 'Verified', body: 'Professionals' },
  { icon: 'flash', from: '#FFF6E0', to: '#FFE8B8', fg: '#F0A400', title: 'Quick', body: 'Easy booking' },
  { glyph: '₹', from: '#E6F7EF', to: '#C8EBDC', fg: '#0E8A6A', title: 'Affordable', body: 'Clear pricing' },
];

// The illustration is anchored bottom-right and its left half is empty, so it can be
// drawn larger than the hero box. This is how much of the width the copy may use -
// the rest is the technician's, and the two never meet.
const COPY_WIDTH = 0.44;
/**
 * Where the technician actually begins inside the artwork, measured from its right edge. The
 * left half of the file is empty, which is what lets it be drawn oversized - but only up to the
 * point where he would reach the words.
 */
const ART_CONTENT_FROM_RIGHT = 0.493;
/** The left of the screen belongs to the copy, however much vertical room there happens to be. */
const COPY_GUARD = 0.47;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// react-native-web renders a real <input>, which the browser gives a square focus
// outline that ignores our rounded field. The halo below replaces it.
const NO_OUTLINE = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

export default function PhoneScreen() {
  const t = useStrings();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const online = useNetwork((s) => s.online);
  const [phone, setPhone] = useState('');
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRequestOtp();

  const compact = height < 760;

  // The artwork is anchored bottom-right and scaled to whatever height the hero actually gets,
  // so it never grows into the copy on short handsets.
  const [heroBox, setHeroBox] = useState({ w: 0, h: 0 });
  const natWidth = heroBox.w || width;
  const natHeight = natWidth * HERO_RATIO;
  const fit = heroBox.h > 0 ? Math.min(1, heroBox.h / natHeight) : 1;
  // the artwork's left half is empty, so drawing it oversized only makes the technician
  // bigger - it grows into that margin, never into the copy column
  const grow = compact ? 1.1 : 1.22;
  // On a tall screen the art would otherwise grow until it crossed the copy, so the width is
  // capped by where the technician starts rather than by the space available.
  const maxScale = (1 - COPY_GUARD) / ART_CONTENT_FROM_RIGHT;
  const scale = Math.max(Math.min((height < 700 ? fit * 0.92 : fit) * grow, maxScale), 0.7);
  const heroWidth = natWidth * scale;
  const heroHeight = natHeight * scale;
  // the copy is laid out top-and-bottom, so this inset is what lifts the feature rows
  // clear of the card and keeps them sitting with the headline rather than under it
  const copyBottomInset = Math.min(Math.max(72, heroHeight * 0.26), compact ? 96 : 140);

  // continuous gentle float of the whole illustration
  const floatY = useSharedValue(0);
  useEffect(() => {
    floatY.value = withRepeat(withTiming(-9, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [floatY]);
  const heroFloat = useAnimatedStyle(() => ({ transform: [{ translateY: floatY.value }] }));

  // press feedback on the primary button
  const ctaScale = useSharedValue(1);
  const ctaStyle = useAnimatedStyle(() => ({ transform: [{ scale: ctaScale.value }] }));

  // shake the field when the number is invalid
  const shake = useSharedValue(0);
  const fieldStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const shakeField = () => {
    shake.value = withSequence(
      withTiming(-8, { duration: 55 }),
      withTiming(8, { duration: 55 }),
      withTiming(-5, { duration: 55 }),
      withTiming(0, { duration: 55 }),
    );
  };

  const submit = async () => {
    const e164 = normaliseIndianPhone(phone);
    if (!e164) {
      setError('Enter a valid 10-digit Indian mobile number');
      shakeField();
      return;
    }
    setError(null);
    try {
      const res = await request.mutateAsync(e164);
      router.push({ pathname: '/(auth)/otp', params: { phone: e164, challengeId: res.challengeId, expires: String(res.expiresInSeconds), demoCode: res.demoCode ?? '' } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
      shakeField();
    }
  };

  const borderColor = error ? palette.danger : focused ? palette.primary : '#E4EDE9';
  const digits = phone.replace(/\D/g, '');
  const complete = normaliseIndianPhone(phone) !== null;

  // a focus halo that follows the field's rounded corners, instead of the square
  // outline a browser draws on the input itself
  const ring = useSharedValue(0);
  const ringStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      ring.value,
      [0, 1],
      ['rgba(18,136,106,0)', error ? 'rgba(214,69,69,0.12)' : 'rgba(18,136,106,0.13)'],
    ),
  }));

  return (
    <LinearGradient colors={['#FFFFFF', '#FBFDFD', '#F4FDFA', '#EAF8F1']} locations={[0, 0.35, 0.72, 1]} style={styles.root}>
      <StatusBar style="dark" />
      <View style={{ paddingTop: insets.top + spacing.xs }}>
        <OfflineBanner visible={!online} label={t('error.OFFLINE')} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}>
          {/* ---------------- brand ---------------- */}
          <Animated.View entering={FadeInDown.duration(500)} style={styles.brand}>
            <LinearGradient colors={['#1BA87E', '#0A6A51']} start={{ x: 0.2, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.logo}>
              <LinearGradient colors={['rgba(255,255,255,0.45)', 'rgba(255,255,255,0)']} style={styles.logoGloss} />
              <Ionicons name="home" size={30} color="#FFFFFF" />
            </LinearGradient>
            <View>
              <Text weight="extrabold" style={styles.brandName}>
                Local<Text weight="extrabold" style={[styles.brandName, styles.brandAccent]}>Hub</Text>
              </Text>
              <Text variant="label" tone="secondary" style={styles.brandTag}>
                {BRAND.tagline}
              </Text>
            </View>
          </Animated.View>

          {/* ---------------- hero ---------------- */}
          <View
            style={styles.hero}
            onLayout={(e) => {
              const { width: w, height: h } = e.nativeEvent.layout;
              setHeroBox((prev) => (Math.abs(prev.w - w) > 1 || Math.abs(prev.h - h) > 1 ? { w, h } : prev));
            }}
          >
            <Animated.View entering={FadeIn.delay(120).duration(700)} style={[styles.heroArt, heroFloat, { opacity: heroBox.h ? 1 : 0, bottom: compact ? -14 : 0 }]} pointerEvents="none">
              <Image source={HERO} style={{ width: heroWidth, height: heroHeight }} resizeMode="contain" accessibilityLabel="Verified LocalHub technician with plumbing, electrical, painting and appliance services" />
            </Animated.View>

            <View style={[styles.heroCopy, { paddingBottom: copyBottomInset }]} pointerEvents="box-none">
              <View>
              <Animated.View entering={FadeInLeft.delay(180).duration(560)}>
                <Text weight="extrabold" style={[styles.welcome, compact && styles.welcomeCompact]}>
                  Welcome!
                </Text>
              </Animated.View>
              <Animated.View entering={FadeInLeft.delay(280).duration(560)}>
                <Text weight="regular" style={[styles.subtitle, compact && styles.subtitleCompact]}>
                  Get trusted professionals{'\n'}for all your home needs
                </Text>
              </Animated.View>
              </View>

              <View style={[styles.features, compact && styles.featuresCompact, { maxWidth: width * COPY_WIDTH + 40 }]}>
                {FEATURES.map((f, i) => (
                  <Animated.View key={f.title} entering={FadeInLeft.delay(400 + i * 110).duration(520)} style={styles.feature}>
                    <LinearGradient colors={[f.from, f.to]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={styles.featureIcon}>
                      {f.icon ? <Ionicons name={f.icon} size={22} color={f.fg} /> : <Text weight="bold" style={[styles.glyph, { color: f.fg }]}>{f.glyph}</Text>}
                    </LinearGradient>
                    <View style={styles.featureText}>
                      <Text weight="semibold" style={[styles.featureTitle, compact && styles.featureCompact]}>
                        {f.title}
                      </Text>
                      <Text weight="regular" style={[styles.featureBody, compact && styles.featureCompact]}>
                        {f.body}
                      </Text>
                    </View>
                  </Animated.View>
                ))}
              </View>
            </View>
          </View>

          {/* ---------------- sign-in card ---------------- */}
          <Animated.View entering={FadeInDown.delay(260).duration(620).springify().damping(18)} style={[styles.card, compact && styles.cardCompact, { marginBottom: insets.bottom + (compact ? spacing.md : spacing.xl) }]}>
            <Text weight="bold" style={styles.cardTitle}>
              Enter your mobile number to continue
            </Text>
            <Text style={styles.fieldLabel}>Mobile number</Text>

            <Animated.View style={[styles.ring, ringStyle, fieldStyle]}>
            <View style={[styles.field, compact && styles.fieldCompact, { borderColor }]}>
              <View accessible accessibilityLabel="Country code India +91" style={styles.country}>
                <View style={styles.flag}>
                  <View style={[styles.flagBand, { backgroundColor: '#FF9933' }]} />
                  <View style={[styles.flagBand, styles.flagMid]}>
                    <View style={styles.chakra} />
                  </View>
                  <View style={[styles.flagBand, { backgroundColor: '#138808' }]} />
                </View>
                <Text weight="semibold" style={styles.code}>
                  +91
                </Text>
              </View>
              <View style={styles.divider} />
              <TextInput
                value={digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits}
                onChangeText={(v) => {
                  setPhone(v.replace(/\D/g, '').slice(0, 10));
                  if (error) setError(null);
                }}
                onFocus={() => {
                  setFocused(true);
                  ring.value = withTiming(1, { duration: 190 });
                }}
                onBlur={() => {
                  setFocused(false);
                  ring.value = withTiming(0, { duration: 190 });
                }}
                onSubmitEditing={submit}
                placeholder="98765 43210"
                placeholderTextColor="#A9B8B1"
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                autoComplete="tel"
                maxLength={11}
                returnKeyType="done"
                accessibilityLabel="Mobile number"
                style={[styles.input, NO_OUTLINE]}
              />
              {complete ? (
                <Animated.View entering={FadeIn.duration(200)}>
                  <Ionicons name="checkmark-circle" size={22} color={palette.primary} />
                </Animated.View>
              ) : digits.length > 0 ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Clear number" hitSlop={10} onPress={() => setPhone('')}>
                  <Ionicons name="close-circle" size={20} color="#C2CEC9" />
                </Pressable>
              ) : null}
            </View>
            </Animated.View>

            {error ? (
              <Animated.View entering={FadeIn.duration(220)} style={styles.noteRow}>
                <Ionicons name="alert-circle" size={15} color={palette.danger} />
                <Text style={[styles.note, { color: palette.danger }]}>{error}</Text>
              </Animated.View>
            ) : (
              <View style={styles.noteRow}>
                <Ionicons name="lock-closed" size={14} color="#93A69E" />
                <Text style={styles.note}>We&apos;ll send a one-time code by SMS</Text>
              </View>
            )}

            <AnimatedPressable
              accessibilityRole="button"
              accessibilityState={{ busy: request.isPending }}
              onPressIn={() => {
                ctaScale.value = withSpring(0.97, { damping: 18, stiffness: 320 });
              }}
              onPressOut={() => {
                ctaScale.value = withSpring(1, { damping: 14, stiffness: 260 });
              }}
              onPress={submit}
              disabled={request.isPending}
              style={[styles.ctaWrap, ctaStyle]}
            >
              <LinearGradient colors={['#12886A', '#0A6A51']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.cta, compact && styles.ctaCompact]}>
                <LinearGradient colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']} style={styles.ctaGloss} />
                <Text weight="bold" style={styles.ctaText}>
                  {request.isPending ? 'Sending code…' : 'Continue'}
                </Text>
                {!request.isPending && <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />}
              </LinearGradient>
            </AnimatedPressable>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },

  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.screen, paddingTop: spacing.lg },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0B6F55',
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 7,
  },
  logoGloss: { position: 'absolute', top: 0, left: 0, right: 0, height: 26, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  brandName: { fontSize: 25, lineHeight: 31, color: '#0F1D18', letterSpacing: -0.4 },
  brandAccent: { color: '#0E8A6A' },
  brandTag: { fontSize: 13, lineHeight: 18, color: '#7C8F88', marginTop: 1 },

  hero: { flex: 1, width: '100%', minHeight: 296, overflow: 'hidden' },
  heroArt: { position: 'absolute', right: 0, bottom: 0 },
  // the bottom inset keeps the feature rows clear of the hand-written line baked into the art
  heroCopy: { flex: 1, paddingHorizontal: spacing.screen, paddingTop: spacing.sm, justifyContent: 'space-between' },
  welcome: { fontSize: 43, lineHeight: 51, color: '#0B1512', letterSpacing: -1.2 },
  welcomeCompact: { fontSize: 35, lineHeight: 42 },
  subtitle: { fontSize: 15.5, lineHeight: 23, color: '#788B84', marginTop: spacing.xs },
  subtitleCompact: { fontSize: 13.5, lineHeight: 20 },
  features: { gap: spacing.lg },
  feature: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  featureIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0B6F55',
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  featureText: { flexShrink: 1 },
  copyColumn: { alignSelf: 'flex-start' },
  featureCompact: { fontSize: 13, lineHeight: 18.5 },
  featuresCompact: { gap: spacing.md },
  featureTitle: { fontSize: 14.5, lineHeight: 20, color: '#16241F' },
  featureBody: { fontSize: 14.5, lineHeight: 20, color: '#7A8D86' },
  glyph: { fontSize: 22, lineHeight: 26 },

  card: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: spacing.md + 2,
    marginTop: -spacing.xxl,
    borderRadius: 26,
    paddingHorizontal: spacing.lg + 2,
    paddingTop: spacing.lg + 2,
    paddingBottom: spacing.lg + 2,
    shadowColor: '#0B3F30',
    shadowOpacity: 0.1,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  cardCompact: { paddingTop: spacing.md, paddingBottom: spacing.md },
  fieldCompact: { height: 52 },
  ctaCompact: { height: 52 },
  cardTitle: { fontSize: 15, lineHeight: 22, letterSpacing: -0.2, color: '#0F1D18' },
  fieldLabel: { fontSize: 12.5, color: '#8C9E97', marginTop: spacing.md + 2, marginBottom: spacing.xs + 2 },
  ring: { borderRadius: 19, padding: 4, marginHorizontal: -4 },
  field: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 56, borderRadius: 15, borderWidth: 1.5, backgroundColor: '#FFFFFF', paddingHorizontal: spacing.md },
  country: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 44 },
  flag: { width: 28, height: 19, borderRadius: 3, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: '#D9E4DF' },
  flagBand: { flex: 1 },
  flagMid: { backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  chakra: { width: 6, height: 6, borderRadius: 3, borderWidth: 1, borderColor: '#000080' },
  code: { fontSize: 15.5, color: '#16241F' },
  divider: { width: 1, height: 28, backgroundColor: '#E4EDE9' },
  input: { flex: 1, fontSize: 16.5, letterSpacing: 0.4, fontFamily: typography.family.medium, color: '#0F1D18', height: '100%' },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: spacing.md },
  note: { fontSize: 12.5, color: '#93A69E', flexShrink: 1 },

  ctaWrap: { marginTop: spacing.lg + 2, borderRadius: radius.pill, shadowColor: '#0A6A51', shadowOpacity: 0.32, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  cta: { height: 56, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, overflow: 'hidden' },
  ctaGloss: { position: 'absolute', top: 0, left: 0, right: 0, height: 28 },
  ctaText: { fontSize: 16.5, color: '#FFFFFF', letterSpacing: 0.2 },
});

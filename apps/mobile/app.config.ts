import type { ExpoConfig } from 'expo/config';

/**
 * Was `app.json` until the map went in.
 *
 * It had to become code for one reason: Android renders Google's tiles from a key in the merged
 * manifest, and a key checked into `app.json` is a credential in the repository. The repo holds no
 * secrets, so the key arrives from the environment and a build without it simply has no key - the
 * app still runs, the map area says what is wrong, and nothing pretends to be live.
 *
 * iOS is left on Apple Maps on purpose. It needs no key at all, which means one less credential to
 * obtain and rotate, and for picking a pin in a city the difference is not something anybody will
 * notice. `ios.config.googleMapsApiKey` is the line to add if that ever stops being true.
 */
const androidMapsKey = process.env.EXPO_PUBLIC_MAPS_ANDROID_KEY;

const config: ExpoConfig = {
  name: 'LocalHub',
  slug: 'hyperlocal-marketplace',
  version: '0.1.0',
  scheme: 'hyperlocal',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.hyperlocal.marketplace',
  },
  android: {
    package: 'com.hyperlocal.marketplace',
    adaptiveIcon: {
      backgroundColor: '#EAF7F1',
    },
    ...(androidMapsKey ? { config: { googleMaps: { apiKey: androidMapsKey } } } : {}),
  },
  web: {
    bundler: 'metro',
    output: 'single',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    'expo-audio',
    'expo-status-bar',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#EAF7F1',
      },
    ],
    [
      /**
       * Foreground only, and the strings say so.
       *
       * These sentences are what a person reads in the system dialog, so they name the reason
       * rather than the capability: somebody deciding whether to allow this deserves to know it is
       * for dropping a pin and for telling a waiting customer how far away you are. There is no
       * background permission here because nothing in this app asks for one.
       */
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'LocalHub uses your location to place your address on the map, and - if you are working a job - to tell the customer how far away you are while you are on your way.',
        locationWhenInUsePermission:
          'LocalHub uses your location to place your address on the map, and - if you are working a job - to tell the customer how far away you are while you are on your way.',
        isAndroidBackgroundLocationEnabled: false,
        isIosBackgroundLocationEnabled: false,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;

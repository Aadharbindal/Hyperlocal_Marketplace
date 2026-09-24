/**
 * The mobile app's first test setup.
 *
 * `jest-expo` is used rather than a hand-rolled transform because the app is full of Expo
 * modules, and mocking each one by hand is how a test suite becomes a second, wrong copy of the
 * SDK. `transformIgnorePatterns` has to let the React Native and Expo packages through: they
 * ship untranspiled ESM, and the default "ignore everything in node_modules" breaks on the first
 * import.
 */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.jsx'],
  testMatch: ['<rootDir>/src/**/*.test.tsx', '<rootDir>/src/**/*.test.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|react-native-reanimated|react-native-worklets|@hyperlocal/core))',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}'],
};

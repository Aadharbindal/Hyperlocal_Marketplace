/**
 * What every component test needs before it can render anything.
 *
 * Each mock here stands in for something that only exists on a real device. They are deliberately
 * thin: a mock that does more than the thing it replaces is a test that passes for the wrong
 * reason.
 */
// The `toBeOnTheScreen` style matchers are built into React Native Testing Library from v12.4
// onward, so there is nothing to register here.

// Reanimated's own mock; without it every animated component throws on the worklet runtime.
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// Safe-area insets come from the device. A fixed set keeps layout assertions stable.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }) => children,
  SafeAreaView: ({ children }) => children,
}));

// Secure storage is native. Tests that care about what was stored assert on these calls.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useSegments: () => [],
  Link: ({ children }) => children,
}));

// React Native's Modal renders nothing under the test renderer, which would quietly make every
// bottom sheet in this app untestable. This stands in for exactly what a Modal does on a device:
// show its children when it is visible, and nothing when it is not.
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const RealModal = jest.requireActual('react-native/Libraries/Modal/Modal');
  const React = require('react');
  const MockModal = ({ visible, children }) =>
    visible === false ? null : React.createElement(React.Fragment, null, children);
  // RN re-exports this module as a default, so the shape has to match or `<Modal>` resolves to
  // undefined and React blames whichever component rendered it.
  return { ...RealModal, __esModule: true, default: MockModal };
});

// Quieten the animation frame warnings that otherwise bury a real failure.
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);

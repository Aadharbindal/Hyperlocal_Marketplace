import { Redirect } from 'expo-router';

// The AuthGate in _layout decides the real destination; this satisfies the router's index route.
export default function Index() {
  return <Redirect href="/(auth)/phone" />;
}

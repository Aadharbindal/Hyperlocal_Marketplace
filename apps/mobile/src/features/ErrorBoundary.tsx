import { Component, type ReactNode } from 'react';
import { View } from 'react-native';
import { reportCrash } from '@/api/crash';
import { palette } from '@/theme';
import { ErrorState } from '@/ui';

interface State {
  error: Error | null;
}

/** Last-resort boundary so a render crash shows a recoverable screen instead of a white page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error) {
    // A crash on somebody's phone in another city is the one failure we can never reproduce and
    // never hear about, so it goes somewhere rather than to the console.
    void reportCrash(error, { screen: 'render' });
  }

  override render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', backgroundColor: palette.ground }}>
          <ErrorState title="Something went wrong" body="Please restart the app. If this keeps happening, contact support." onRetry={() => this.setState({ error: null })} />
        </View>
      );
    }
    return this.props.children;
  }
}

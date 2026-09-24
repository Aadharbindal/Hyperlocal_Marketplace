import { fireEvent, render, screen } from '@testing-library/react-native';
import { Badge, Button, EmptyState, Text } from './index';

/**
 * The first component tests this app has had.
 *
 * They are deliberately about *behaviour a person would notice*: that a disabled button does not
 * fire, that a loading one cannot be pressed twice, that something pressable can be found by the
 * name a screen reader would read out. Tests that assert on styles break every time a designer
 * breathes and prove nothing about whether the app works.
 *
 * One thing worth knowing before writing more of these: **`render` is asynchronous** in React
 * Native Testing Library v14. It returns a promise, so a test that forgets to await it gets an
 * empty screen and an error that blames the query rather than the render.
 */

describe('Button', () => {
  it('calls back when pressed', async () => {
    const onPress = jest.fn();
    await render(<Button title="Send offer" onPress={onPress} />);

    fireEvent.press(screen.getByText('Send offer'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled', async () => {
    const onPress = jest.fn();
    await render(<Button title="Accept" onPress={onPress} disabled />);

    fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('cannot be pressed twice while it is working', async () => {
    // The one that matters: a double-tapped "accept" is a double booking, and the server's
    // idempotency key is the second line of defence, not the first.
    const onPress = jest.fn();
    await render(<Button title="Accept" onPress={onPress} loading />);

    fireEvent.press(screen.getByRole('button'));
    fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('is reachable by the name a screen reader reads out', async () => {
    await render(<Button title="Book again" onPress={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Book again' })).toBeTruthy();
  });
});

describe('Badge', () => {
  it('shows the label it was given', async () => {
    await render(<Badge tone="success" label="verified" />);
    expect(screen.getByText('verified')).toBeTruthy();
  });
});

describe('EmptyState', () => {
  it('explains itself rather than showing a blank screen', async () => {
    await render(
      <EmptyState icon="briefcase-outline" title="No live jobs" body="Jobs you win appear here." />,
    );
    expect(screen.getByText('No live jobs')).toBeTruthy();
    expect(screen.getByText('Jobs you win appear here.')).toBeTruthy();
  });

  it('offers a way out when there is one', async () => {
    const onAction = jest.fn();
    await render(
      <EmptyState
        icon="funnel-outline"
        title="Nothing matches those filters"
        body="There is work nearby, but none within 3 km."
        actionLabel="Clear filters"
        onAction={onAction}
      />,
    );

    fireEvent.press(screen.getByText('Clear filters'));
    expect(onAction).toHaveBeenCalled();
  });
});

describe('Text', () => {
  it('renders what it is given', async () => {
    await render(<Text>Kitchen tap leaking</Text>);
    expect(screen.getByText('Kitchen tap leaking')).toBeTruthy();
  });
});

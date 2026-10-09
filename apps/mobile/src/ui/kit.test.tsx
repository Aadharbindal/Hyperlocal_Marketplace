import { fireEvent, render, screen } from '@testing-library/react-native';
import { ChipMultiSelect, DataRow, ListRow, SegmentedControl, StatTile, Stepper, TextField } from './index';

/**
 * The components added when the UI kit was pulled back together.
 *
 * Note the `await` on every `fireEvent`. React Native Testing Library v14 renders through React's
 * concurrent path, so a press or a blur that causes a re-render has not landed by the time the next
 * line runs - and an unawaited update does not merely fail its own assertion, it leaves the renderer
 * mid-update and the *following* tests in the file find an empty screen. That is a confusing hour if
 * you read the second failure first.
 *
 * Nineteen screens had their own `<TextInput>`, eight had their own chip row, five had their own
 * `Stat` and seven their own `Row`. These tests are about the part of that consolidation that is
 * easy to break again and impossible to see in a screenshot: **what a screen reader is told.** The
 * hand-rolled versions were not ugly, they were mute - a row of chips that announced itself as
 * eight unrelated buttons, a stat whose number and label arrived as two unconnected strings.
 *
 * As in `ui.test.tsx`: `render` is asynchronous in React Native Testing Library v14, and a test
 * that forgets to await it gets an empty screen and an error blaming the query.
 */

describe('TextField', () => {
  it('complains on blur, not while somebody is still typing', async () => {
    // The rule the whole validation design rests on. An error that appears at "r@" and vanishes at
    // "r@gmail.com" is noise people learn to ignore, so by the time it means something they have
    // stopped reading it.
    const check = (v: string) => (v.includes('@') ? null : { message: 'That is not an email address.' });
    await render(<TextField label="Email" value="nope" onChangeText={jest.fn()} validate={check} />);

    expect(screen.queryByText('That is not an email address.')).toBeNull();
    await fireEvent(screen.getByLabelText('Email'), 'blur');
    expect(screen.getByText('That is not an email address.')).toBeTruthy();
  });

  it('clears its complaint when somebody comes back to fix it', async () => {
    const check = () => ({ message: 'Fix this.' });
    await render(<TextField label="City" value="x" onChangeText={jest.fn()} validate={check} />);

    await fireEvent(screen.getByLabelText('City'), 'blur');
    expect(screen.getByText('Fix this.')).toBeTruthy();
    // Being shouted at while you repair something is how a form comes to feel hostile.
    await fireEvent(screen.getByLabelText('City'), 'focus');
    expect(screen.queryByText('Fix this.')).toBeNull();
  });

  it('says nothing about an empty optional field', async () => {
    const check = jest.fn(() => ({ message: 'Required!' }));
    await render(<TextField label="Landmark" value="   " onChangeText={jest.fn()} validate={check} />);

    await fireEvent(screen.getByLabelText('Landmark'), 'blur');
    // Whether a field is required is the form's business, not this component's.
    expect(check).not.toHaveBeenCalled();
    expect(screen.queryByText('Required!')).toBeNull();
  });

  it('offers a correction and never applies one', async () => {
    // Silently rewriting somebody's email is how a receipt goes to a stranger.
    const onAccept = jest.fn();
    const check = () => ({ message: 'Did you mean ravi@gmail.com?', suggestion: 'ravi@gmail.com' });
    await render(
      <TextField
        label="Email"
        value="ravi@gmial.com"
        onChangeText={jest.fn()}
        validate={check}
        onAcceptSuggestion={onAccept}
      />,
    );

    await fireEvent(screen.getByLabelText('Email'), 'blur');
    expect(onAccept).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Use ravi@gmail.com'));
    expect(onAccept).toHaveBeenCalledWith('ravi@gmail.com');
  });

  it('lets an error from the caller win over its own', async () => {
    // The server knows things the client cannot - that an address is already on another account.
    const check = () => ({ message: 'Local complaint.' });
    await render(
      <TextField
        label="Email"
        value="x@y.com"
        onChangeText={jest.fn()}
        validate={check}
        error="Already used by another account."
      />,
    );

    await fireEvent(screen.getByLabelText('Email'), 'blur');
    expect(screen.getByText('Already used by another account.')).toBeTruthy();
    expect(screen.queryByText('Local complaint.')).toBeNull();
  });

  it('counts down only once there is something to count', async () => {
    // "0 / 300" under an empty box reads as a requirement rather than a limit.
    const { rerender } = await render(
      <TextField label="Note" value="" onChangeText={jest.fn()} maxLength={300} counter />,
    );
    expect(screen.queryByText('0 / 300')).toBeNull();

    await rerender(<TextField label="Note" value="Tap is leaking" onChangeText={jest.fn()} maxLength={300} counter />);
    expect(screen.getByText('14 / 300')).toBeTruthy();
  });
});

describe('SegmentedControl', () => {
  it('announces itself as a group of choices, not a row of buttons', async () => {
    // The reason this component exists. Eight screens had hand-rolled chips with
    // `accessibilityRole="button"`, so a screen reader said "Partial refund, button" with no hint
    // that picking it unpicked something else.
    await render(
      <SegmentedControl
        label="Outcome"
        options={[
          { value: 'a', label: 'No action' },
          { value: 'b', label: 'Partial refund' },
        ]}
        value="a"
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('Outcome')).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    // `checked`, matching what a radio actually exposes. Asserting `selected` passed here while
    // the rendered DOM carried no state at all, because the query reads `accessibilityState` and
    // React Native Web drops `aria-selected` on a radio.
    expect(screen.getByRole('radio', { name: 'No action', checked: true })).toBeTruthy();
  });

  it('reports the value that was chosen', async () => {
    const onChange = jest.fn();
    await render(
      <SegmentedControl
        options={[
          { value: 'home', label: 'Home' },
          { value: 'work', label: 'Work' },
        ]}
        value="home"
        onChange={onChange}
      />,
    );

    await fireEvent.press(screen.getByLabelText('Work'));
    expect(onChange).toHaveBeenCalledWith('work');
  });

  it('will not fire for a disabled option', async () => {
    const onChange = jest.fn();
    await render(
      <SegmentedControl options={[{ value: 'x', label: 'Tomorrow', disabled: true }]} value={null} onChange={onChange} />,
    );

    await fireEvent.press(screen.getByLabelText('Tomorrow'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reads a hint out as part of the option', async () => {
    // Otherwise the hint is a stray line of text somewhere near a chip, and the connection between
    // "Every 3 months" and "most people pick this" exists only for people who can see the layout.
    await render(
      <SegmentedControl
        stacked
        options={[{ value: 'q', label: 'Every 3 months', hint: 'most people pick this' }]}
        value="q"
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByLabelText('Every 3 months. most people pick this')).toBeTruthy();
  });
});

describe('ChipMultiSelect', () => {
  it('announces checkboxes, because several can be on at once', async () => {
    await render(
      <ChipMultiSelect
        label="Skills"
        options={[
          { value: 'tap', label: 'Tap repair' },
          { value: 'geyser', label: 'Geyser' },
        ]}
        value={['tap']}
        onToggle={jest.fn()}
      />,
    );

    // A provider working down fourteen skill chips needs to hear which ones are already on.
    expect(screen.getByRole('checkbox', { name: 'Tap repair', checked: true })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Geyser', checked: false })).toBeTruthy();
  });

  it('toggles the one that was pressed', async () => {
    const onToggle = jest.fn();
    await render(
      <ChipMultiSelect options={[{ value: 'geyser', label: 'Geyser' }]} value={[]} onToggle={onToggle} />,
    );
    await fireEvent.press(screen.getByLabelText('Geyser'));
    expect(onToggle).toHaveBeenCalledWith('geyser');
  });
});

describe('Stepper', () => {
  it('counts up and down', async () => {
    const onChange = jest.fn();
    await render(<Stepper label="Quantity" value={2} onChange={onChange} />);

    await fireEvent.press(screen.getByLabelText('More, Quantity'));
    expect(onChange).toHaveBeenCalledWith(3);
    await fireEvent.press(screen.getByLabelText('Fewer, Quantity'));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('stops at its floor instead of going below it', async () => {
    // Half the point of replacing the numeric text box: it could hold an empty string, and the form
    // then had to decide what zero of something meant.
    const onChange = jest.fn();
    await render(<Stepper label="Quantity" value={1} onChange={onChange} min={1} max={3} />);
    await fireEvent.press(screen.getByLabelText('Fewer, Quantity'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stops at its ceiling too', async () => {
    // The other half: nobody sends a supplier a request for 999 tap cartridges by holding a key.
    const onChange = jest.fn();
    await render(<Stepper label="Quantity" value={3} onChange={onChange} min={1} max={3} />);
    await fireEvent.press(screen.getByLabelText('More, Quantity'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reads the current value as part of the control', async () => {
    await render(<Stepper label="Quantity for brass cartridge" value={4} onChange={jest.fn()} unit="pcs" />);
    expect(screen.getByLabelText('Quantity for brass cartridge, 4 pcs')).toBeTruthy();
  });
});

describe('StatTile', () => {
  it('reads as one thing rather than two stray labels', async () => {
    await render(<StatTile label="Earned" value="1,240" hint="this month" />);
    // In a row of four tiles, "1,240" and "Earned" announced separately lose their pairing.
    expect(screen.getByLabelText('Earned: 1,240. this month')).toBeTruthy();
  });
});

describe('ListRow', () => {
  it('makes a whole row one tappable element with one name', async () => {
    const onPress = jest.fn();
    await render(<ListRow title="Home" subtitle="12, Lodhi Colony" onPress={onPress} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Home. 12, Lodhi Colony' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is not a button when there is nothing to press', async () => {
    await render(<ListRow title="Ramesh" subtitle="Technician" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Ramesh')).toBeTruthy();
  });
});

describe('DataRow', () => {
  it('shows a label and its value', async () => {
    await render(<DataRow label="Platform fee" value="35" />);
    expect(screen.getByText('Platform fee')).toBeTruthy();
    expect(screen.getByText('35')).toBeTruthy();
  });
});

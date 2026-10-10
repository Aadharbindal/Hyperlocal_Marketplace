import { fireEvent, render, screen } from '@testing-library/react-native';
import { SetupChecklist } from './SetupChecklist';

/**
 * What a professional sees on their first day.
 *
 * The screen this replaced showed a verification card and, below it, an empty state naming one
 * other blocker - two of four tasks, in two different shapes, with nothing saying how much was
 * left. These tests are about the two properties that made it worth replacing: the whole list is
 * visible, and exactly one thing is offered to act on.
 *
 * As in `kit.test.tsx`: `render` and `fireEvent` are awaited, because React Native Testing Library
 * v14 renders through React's concurrent path and an unawaited update corrupts the tests after it.
 */

const ALL = ['VERIFICATION_PENDING', 'AVAILABILITY_OFF', 'NO_SKILLS_SELECTED', 'NO_BASE_LOCATION'];

describe('SetupChecklist', () => {
  it('shows every step, not only the next one', async () => {
    await render(<SetupChecklist blockers={ALL} onAction={jest.fn()} />);

    expect(screen.getByText('0 of 4 done')).toBeTruthy();
    for (const title of ['Get verified', 'Pick your services', 'Set where you work from', 'Go online']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it('keeps finished steps on screen rather than dropping them', async () => {
    // Three ticks and one empty circle is a different feeling from one instruction, and it is the
    // honest picture - they really have done three things.
    await render(<SetupChecklist blockers={['NO_BASE_LOCATION']} onAction={jest.fn()} />);

    expect(screen.getByText('3 of 4 done')).toBeTruthy();
    expect(screen.getByText('Verified')).toBeTruthy();
    expect(screen.getByText('Services chosen')).toBeTruthy();
    expect(screen.getByText('Set where you work from')).toBeTruthy();
  });

  it('explains only the step they are on', async () => {
    // Four explanations is a wall of text on the screen somebody is trying to get past.
    await render(<SetupChecklist blockers={ALL} onAction={jest.fn()} />);

    expect(screen.getByText('Submit one ID document so customers know who is coming.')).toBeTruthy();
    expect(screen.queryByText('Jobs are matched by how far they are from this address.')).toBeNull();
  });

  it('offers one action, for the first thing left to do', async () => {
    // Four buttons would be four decisions. There is a correct order here - the server refuses to
    // put somebody online before verification - so the screen may as well say so.
    const onAction = jest.fn();
    await render(<SetupChecklist blockers={ALL} onAction={onAction} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    await fireEvent.press(buttons[0]);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('offers nothing to press when the only step left is the switch upstairs', async () => {
    // "Go online" deliberately has no button: the switch is already in this screen's header, and a
    // second control for it would be a second source of truth.
    await render(<SetupChecklist blockers={['AVAILABILITY_OFF']} onAction={jest.fn()} />);

    expect(screen.getByText('3 of 4 done')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('tells a screen reader whether a step is done, without relying on the tick', async () => {
    await render(<SetupChecklist blockers={['NO_BASE_LOCATION']} onAction={jest.fn()} />);

    expect(screen.getByLabelText('Done: Verified')).toBeTruthy();
    expect(screen.getByLabelText('Still to do: Set where you work from')).toBeTruthy();
  });
});

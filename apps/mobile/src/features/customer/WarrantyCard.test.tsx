import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import type { WarrantyStatusView } from '@hyperlocal/core';
import { WarrantyCard } from './WarrantyCard';

/**
 * The warranty card is the one screen that has to be right about money and promises, so it is
 * worth testing at the component level rather than only through the API.
 *
 * The API layer is mocked at the hook boundary: this is a test about what a customer is told,
 * not about how the request is shaped - that is covered by `warranty.test.ts` on the server.
 * Mocking there also means no QueryClientProvider is needed, which keeps the test about the
 * component rather than about its plumbing.
 */

// Jest hoists `jest.mock` above the file, so anything its factory closes over has to be named
// `mock*` - that prefix is the only thing that tells Jest the reference is deliberate.
const mockRaise = jest.fn();
const mockBookRevisit = jest.fn();
let mockStatus: { data: WarrantyStatusView | undefined };

jest.mock('@/api/warranty', () => ({
  useWarrantyStatus: () => mockStatus,
  useRaiseWarrantyClaim: () => ({ mutateAsync: mockRaise, isPending: false }),
  useBookRevisit: () => ({ mutate: mockBookRevisit, isPending: false }),
  useResolveClaim: () => ({ mutate: jest.fn(), isPending: false }),
}));

const covered: WarrantyStatusView = {
  warrantyDays: 15,
  coveredUntil: new Date(Date.now() + 11 * 24 * 3600_000).toISOString(),
  daysLeft: 11,
  active: true,
  canClaim: true,
  reason: null,
  claim: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStatus = { data: covered };
});

describe('what a customer is told about their warranty', () => {
  it('shows the cover and how long is left', async () => {
    await render(<WarrantyCard jobId="job-1" finished />);
    expect(screen.getByText('15-day warranty')).toBeTruthy();
    expect(screen.getByText('11 days of cover left')).toBeTruthy();
  });

  it('says the return visit is free, which is the whole promise', async () => {
    await render(<WarrantyCard jobId="job-1" finished />);
    expect(screen.getByText(/returns at no charge/)).toBeTruthy();
  });

  it('says nothing at all on a job that is not finished', async () => {
    await render(<WarrantyCard jobId="job-1" finished={false} />);
    expect(screen.queryByText('15-day warranty')).toBeNull();
  });

  it('says nothing on a booking that never carried a warranty', async () => {
    mockStatus = { data: { ...covered, warrantyDays: 0 } };
    await render(<WarrantyCard jobId="job-1" finished />);
    expect(screen.queryByText(/warranty/i)).toBeNull();
  });

  it('explains why a claim cannot be made, rather than hiding the button', async () => {
    mockStatus = {
      data: {
        ...covered,
        active: false,
        canClaim: false,
        daysLeft: 0,
        reason: 'The 15-day warranty on this work has ended. You can still raise a dispute or book again.',
      },
    };
    await render(<WarrantyCard jobId="job-1" finished />);

    // Matched on the sentence itself: "This cover has ended" appears in the subtitle too.
    expect(screen.getByText(/You can still raise a dispute or book again/)).toBeTruthy();
    // A missing button teaches nobody anything; a sentence does.
    expect(screen.queryByText('Something has gone wrong again')).toBeNull();
  });
});

describe('raising a claim', () => {
  it('will not submit until there is enough to act on', async () => {
    await render(<WarrantyCard jobId="job-1" finished />);
    // `userEvent` is awaited on purpose: opening the sheet is a state update, and under React 19
    // the synchronous `fireEvent` returns before the new tree exists.
    await userEvent.press(screen.getByText('Something has gone wrong again'));

    await userEvent.type(screen.getByPlaceholderText(/same tap started dripping/i), 'broken');

    // The server refuses anything under twenty characters; refusing it here saves a round trip
    // and tells the person how much more is needed.
    expect(screen.getByText('14 more characters')).toBeTruthy();
    await userEvent.press(screen.getByText('Raise the claim'));
    expect(mockRaise).not.toHaveBeenCalled();
  });

  it('submits once there is a real description', async () => {
    await render(<WarrantyCard jobId="job-1" finished />);
    await userEvent.press(screen.getByText('Something has gone wrong again'));

    const description = 'The same tap has started dripping again, three days after the repair.';
    await userEvent.type(screen.getByPlaceholderText(/same tap started dripping/i), description);
    await userEvent.press(screen.getByText('Raise the claim'));

    expect(mockRaise).toHaveBeenCalledWith({ description });
  });
});

describe('once a claim exists', () => {
  it('shows the professional own words when they decline', async () => {
    mockStatus = {
      data: {
        ...covered,
        canClaim: false,
        claim: {
          id: 'claim-1',
          jobId: 'job-1',
          categoryName: 'Plumbing',
          status: 'DECLINED',
          description: 'Dripping again',
          mediaUrls: [],
          warrantyDays: 15,
          coveredUntil: covered.coveredUntil!,
          providerName: 'Suresh Plumbing',
          providerResponse: null,
          declineReason: 'The new leak is on a different pipe, upstream of the joint I replaced.',
          revisitJobId: null,
          awaitingSupport: false,
          resolutionNote: null,
          createdAt: new Date().toISOString(),
        },
      },
    };
    await render(<WarrantyCard jobId="job-1" finished />);

    expect(screen.getByText(/different pipe/)).toBeTruthy();
    // And a way forward, rather than a dead end.
    expect(screen.getByText(/raise a dispute/)).toBeTruthy();
  });

  it('offers the free return visit once it is accepted', async () => {
    mockStatus = {
      data: {
        ...covered,
        canClaim: false,
        claim: {
          id: 'claim-2',
          jobId: 'job-1',
          categoryName: 'Plumbing',
          status: 'ACCEPTED',
          description: 'Dripping again',
          mediaUrls: [],
          warrantyDays: 15,
          coveredUntil: covered.coveredUntil!,
          providerName: 'Suresh Plumbing',
          providerResponse: null,
          declineReason: null,
          revisitJobId: null,
          awaitingSupport: false,
          resolutionNote: null,
          createdAt: new Date().toISOString(),
        },
      },
    };
    await render(<WarrantyCard jobId="job-1" finished />);

    expect(screen.getByText('The return visit is free of charge.')).toBeTruthy();
    fireEvent.press(screen.getByText('Book the return visit'));
    expect(mockBookRevisit).toHaveBeenCalled();
  });

  it('tells the customer when support has taken over', async () => {
    mockStatus = {
      data: {
        ...covered,
        canClaim: false,
        claim: {
          id: 'claim-3',
          jobId: 'job-1',
          categoryName: 'Plumbing',
          status: 'ESCALATED',
          description: 'Dripping again',
          mediaUrls: [],
          warrantyDays: 15,
          coveredUntil: covered.coveredUntil!,
          providerName: 'Suresh Plumbing',
          providerResponse: null,
          declineReason: null,
          revisitJobId: null,
          awaitingSupport: true,
          resolutionNote: null,
          createdAt: new Date().toISOString(),
        },
      },
    };
    await render(<WarrantyCard jobId="job-1" finished />);
    expect(screen.getByText(/our team is stepping in/)).toBeTruthy();
  });
});

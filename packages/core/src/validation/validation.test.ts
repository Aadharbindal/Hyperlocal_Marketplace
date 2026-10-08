import { describe, expect, it } from 'vitest';
import {
  checkAddressLine,
  checkBankAccountNumber,
  checkBusinessName,
  checkCity,
  checkEmail,
  checkFutureDateTime,
  checkIfsc,
  checkIndianMobile,
  checkMeaningfulText,
  checkMobileField,
  checkPersonName,
  checkPincode,
  checkReason,
  checkReferralCode,
  checkRupees,
  checkUpiVpa,
} from './validation';

/**
 * Half of these tests check that junk is rejected. The other half - the half that matters more -
 * check that **real answers are not**.
 *
 * A validator that turns away a real customer is worse than one that lets junk through: the junk
 * costs a support ticket, the false rejection costs the customer entirely and they never say
 * why. Indian names, addresses and buildings are far more varied than any regex written at a
 * desk, so every rule here has a companion test holding the line against over-reach.
 */

describe('mobile numbers', () => {
  it('accepts the numbers people actually have', () => {
    for (const n of ['9812345678', '7000000001', '6200112233', '8888812345']) {
      expect(checkIndianMobile(n)).toBeNull();
    }
  });

  it('accepts a memorable number that looks like a placeholder', () => {
    // 9876543210 is validly allocated and somebody holds it. Rejecting sequences would lock that
    // person out of the product for having a tidy phone number.
    expect(checkIndianMobile('9876543210')).toBeNull();
  });

  it('rejects a held-down key', () => {
    expect(checkIndianMobile('9999999999')).not.toBeNull();
    expect(checkIndianMobile('8888888888')).not.toBeNull();
  });

  it('rejects numbers that are not Indian mobiles', () => {
    expect(checkIndianMobile('1234567890')).not.toBeNull(); // landline-shaped
    expect(checkIndianMobile('98123456')).not.toBeNull(); // too short
    expect(checkIndianMobile('5812345678')).not.toBeNull(); // no such prefix
  });
});

describe('email', () => {
  it('accepts ordinary addresses', () => {
    for (const e of [
      'ravi@example.com',
      'ravi.kumar+receipts@gmail.com',
      'r@iitd.ac.in',
      'first_last@company.co.in',
    ]) {
      expect(checkEmail(e)).toBeNull();
    }
  });

  it('suggests the domain somebody meant, rather than silently fixing it', () => {
    // Quietly correcting an address is how a receipt goes to a stranger.
    const p = checkEmail('ravi@gmial.com');
    expect(p?.suggestion).toBe('ravi@gmail.com');
    expect(p?.message).toContain('gmail.com');
  });

  it('turns away a throwaway inbox, because of what the address is for', () => {
    expect(checkEmail('someone@mailinator.com')).not.toBeNull();
    expect(checkEmail('x@10minutemail.com')).not.toBeNull();
  });

  it('catches the slips that are genuinely invalid', () => {
    expect(checkEmail('ravi@@example.com')).not.toBeNull();
    expect(checkEmail('.ravi@example.com')).not.toBeNull();
    expect(checkEmail('ravi..kumar@example.com')).not.toBeNull();
    expect(checkEmail('ravi@example')).not.toBeNull();
    expect(checkEmail('ravi@.com')).not.toBeNull();
  });
});

describe('PIN codes', () => {
  it('accepts real ones from several regions', () => {
    for (const p of ['110003', '400001', '560001', '700001', '834001']) {
      expect(checkPincode(p)).toBeNull();
    }
  });

  it('rejects the two things most often typed into a PIN box', () => {
    expect(checkPincode('000000')).not.toBeNull();
    expect(checkPincode('999999')).not.toBeNull();
  });

  it('rejects anything that is not six digits', () => {
    expect(checkPincode('11000')).not.toBeNull();
    expect(checkPincode('1100034')).not.toBeNull();
    expect(checkPincode('11000a')).not.toBeNull();
  });
});

describe('names', () => {
  it('accepts the shapes real names come in', () => {
    for (const n of [
      'Ravi Kumar',
      'Jo',                 // short, and real
      'D’Souza',        // apostrophe
      'Priya-Anne',          // hyphen
      'Lakshmi',             // one word, no surname
      'रवि',  // Devanagari
      'Mohammed Abdul Rahman Khan',
    ]) {
      expect(checkPersonName(n)).toBeNull();
    }
  });

  it('rejects only what is clearly not a name', () => {
    expect(checkPersonName('asdfgh')).not.toBeNull();
    expect(checkPersonName('aaaa')).not.toBeNull();
    expect(checkPersonName('Ravi123')).not.toBeNull();
    expect(checkPersonName('x')).not.toBeNull();
  });
});

describe('address lines', () => {
  it('accepts the ways people write addresses', () => {
    for (const a of [
      '12, Lodhi Colony',
      'Green Park Extension',        // no number at all
      'Flat 402, Tower B',
      'H.No. 5/21',
      'Near the water tank, Sector 9',
      'सेक्टर 15',
    ]) {
      expect(checkAddressLine(a)).toBeNull();
    }
  });

  it('rejects junk', () => {
    expect(checkAddressLine('asdasd')).not.toBeNull();
    expect(checkAddressLine('aaaaaa')).not.toBeNull();
    expect(checkAddressLine('xy')).not.toBeNull();
  });
});

describe('cities', () => {
  it('accepts real ones', () => {
    for (const c of ['Delhi', 'New Delhi', 'Bengaluru', 'Thiruvananthapuram']) {
      expect(checkCity(c)).toBeNull();
    }
  });
  it('rejects junk and numbers', () => {
    expect(checkCity('asdf')).not.toBeNull();
    expect(checkCity('Delhi 2')).not.toBeNull();
  });
});

describe('text somebody has to act on', () => {
  it('accepts a real description', () => {
    expect(checkMeaningfulText('Kitchen tap has been dripping since this morning', 20, 'The description')).toBeNull();
  });

  it('rejects padding that meets the length but says nothing', () => {
    // Length alone never caught this: the point of a minimum is that somebody can act on it.
    expect(checkMeaningfulText('aaaaaaaaaaaaaaaaaaaaaaaa', 20, 'The description')).not.toBeNull();
    expect(checkMeaningfulText('asdfghjklasdfghjklasdf', 20, 'The description')).not.toBeNull();
    expect(checkMeaningfulText('123456789012345678901234', 20, 'The description')).not.toBeNull();
  });

  it('still enforces the minimum', () => {
    expect(checkMeaningfulText('Tap leaks', 20, 'The description')).not.toBeNull();
  });
});

/**
 * The payout checks are the one group here that leans strict, and the tests are weighted the other
 * way round because of it. A false rejection on this screen costs a support message; a false
 * acceptance sends somebody's earnings to a valid account belonging to a stranger, and nothing
 * unwinds that.
 */
describe('where the money goes', () => {
  it('insists on the zero the RBI reserves in an IFSC', () => {
    expect(checkIfsc('HDFC0001234')).toBeNull();
    expect(checkIfsc('sbin0000456')).toBeNull(); // case is the form's problem, not the person's
    // The transposition a plain length-11 check waves through, and that then fails at the bank days
    // after a payout was promised.
    expect(checkIfsc('HDFCO001234')?.message).toContain('11 characters');
    expect(checkIfsc('HDFC00012345')).not.toBeNull();
  });

  it('accepts the account numbers banks actually issue', () => {
    expect(checkBankAccountNumber('123456789')).toBeNull();
    expect(checkBankAccountNumber('504210110004321')).toBeNull();
    expect(checkBankAccountNumber('12345678901234567')).toBeNull();
  });

  it('refuses a number somebody typed to get past the form', () => {
    expect(checkBankAccountNumber('000000000')?.message).toContain('real account number');
    expect(checkBankAccountNumber('1234 5678 9012')?.message).toContain('no spaces');
    expect(checkBankAccountNumber('12345')).not.toBeNull();
  });

  it('names the email-in-the-UPI-box mistake instead of just refusing it', () => {
    // The right shape, a real address the person genuinely has, and not a UPI id. Saying so is the
    // difference between a ten-second fix and somebody deciding our form is broken.
    expect(checkUpiVpa('aadhar@gmail.com')?.message).toContain('email address');
    expect(checkUpiVpa('9876543210@ybl')).toBeNull();
    expect(checkUpiVpa('aadhar.bindal@okaxis')).toBeNull();
    expect(checkUpiVpa('shop-24x7@paytm')).toBeNull();
    expect(checkUpiVpa('noatsign')).not.toBeNull();
    expect(checkUpiVpa('two@at@signs')).not.toBeNull();
  });
});

describe('a mobile number typed into a box rather than normalised', () => {
  it('understands every way somebody writes their own number', () => {
    expect(checkMobileField('9810012345')).toBeNull();
    expect(checkMobileField('+91 98100 12345')).toBeNull();
    expect(checkMobileField('098100-12345')).toBeNull();
  });

  it('asks for the rest rather than calling a half-typed number invalid', () => {
    // Fired on blur, so this is somebody who tabbed away mid-number. "Invalid" would be a lie.
    expect(checkMobileField('98100')?.message).toContain('all 10 digits');
    expect(checkMobileField('')).toBeNull();
  });

  it('still refuses a held-down key', () => {
    expect(checkMobileField('9999999999')).not.toBeNull();
  });
});

describe('reasons, reviews and shop names', () => {
  it('takes two real words as a complete reason', () => {
    // The minimum is low on purpose. Demanding a paragraph is how you get a paragraph of asdasd.
    expect(checkReason('Pipe burst upstairs')).toBeNull();
    expect(checkReason('guard refused entry')).toBeNull();
    expect(checkReason('asdasdasdasd')).not.toBeNull();
    expect(checkReason('ok')).not.toBeNull();
  });

  it('lets a shop be named with digits, and in any script', () => {
    expect(checkBusinessName('A1 Electricals')).toBeNull();
    expect(checkBusinessName('24x7 Plumbing')).toBeNull();
    expect(checkBusinessName('शर्मा हार्डवेयर')).toBeNull();
    expect(checkBusinessName('1234')).not.toBeNull();
    expect(checkBusinessName('aaaaaa')).not.toBeNull();
  });
});

describe('the junk string that slips past a keyboard-run check', () => {
  it('catches a short chunk repeated', () => {
    // "asd" is three characters, so a detector looking for five keys in a row never sees it however
    // many times it is typed - and this is the most common junk string of all.
    expect(checkMeaningfulText('asdasdasdasd', 10, 'A reason')).not.toBeNull();
    expect(checkMeaningfulText('abcabcabcabc', 10, 'A reason')).not.toBeNull();
  });

  it('leaves reduplication alone, because that is how people speak', () => {
    // "dhire dhire", "jaldi jaldi", "chhota chhota" are ordinary Hindi and ordinary Indian English.
    // Rejecting them would be a validator correcting somebody's language.
    expect(checkMeaningfulText('dhire dhire kaam karo', 10, 'A note')).toBeNull();
    expect(checkMeaningfulText('chhota chhota leak hai', 10, 'A note')).toBeNull();
    expect(checkMeaningfulText('bahut bahut dhanyavaad', 10, 'A note')).toBeNull();
  });
});

describe('a date and time typed by hand', () => {
  const NOW = new Date(2026, 9, 1, 12, 0); // 1 October 2026, midday

  it('accepts a real time in the near future', () => {
    expect(checkFutureDateTime('2026-10-04 15:30', NOW)).toBeNull();
    expect(checkFutureDateTime('2026-10-04T15:30', NOW)).toBeNull();
  });

  it('refuses a day that does not exist, which Date would silently roll forward', () => {
    // `new Date(2026, 1, 31)` is 3 March. Without the round-trip check somebody would be booked onto
    // a day they did not choose and would never be told.
    expect(checkFutureDateTime('2027-02-31 10:00', NOW)?.message).toContain('no 31st');
  });

  it('says which thing is wrong rather than listing every rule', () => {
    expect(checkFutureDateTime('04/10/2026 15:30', NOW)?.message).toContain('like 2026-10-04 15:30');
    expect(checkFutureDateTime('2026-13-04 15:30', NOW)?.message).toContain('month');
    expect(checkFutureDateTime('2026-10-04 25:30', NOW)?.message).toContain('24-hour');
    expect(checkFutureDateTime('2026-09-30 15:30', NOW)?.message).toContain('already passed');
    expect(checkFutureDateTime('2036-10-04 15:30', NOW)?.message).toContain('days away');
  });

  it('says nothing about an empty field', () => {
    // Validated on blur, and somebody who has not typed anything yet has not made a mistake.
    expect(checkFutureDateTime('', NOW)).toBeNull();
  });
});

describe('the ordinal in that message', () => {
  const NOW = new Date(2026, 9, 1, 12, 0);
  it('gets the awkward ones right', () => {
    // 31st, not 31th. A validator that cannot spell is one more reason not to trust the form.
    expect(checkFutureDateTime('2026-11-31 10:00', NOW)?.message).toContain('no 31st');
    // And 32nd, not 32rd - the two-digit day passes the pattern, so this message does get reached.
    expect(checkFutureDateTime('2026-11-32 10:00', NOW)?.message).toContain('no 32nd');
  });
});

describe('a referral code read off somebody else’s screen', () => {
  it('names the character that was misread', () => {
    // The generator leaves 0, 1, I and O out of its alphabet so a code can be said out loud. That
    // makes any of them a certain misread - and "invalid code" would waste the one thing we know.
    expect(checkReferralCode('4K7O2M')?.message).toContain('look at the "O"');
    expect(checkReferralCode('4K712M')?.message).toContain('0, 1, I or O');
  });

  it('accepts a real code in either case', () => {
    expect(checkReferralCode('4K7Q2M')).toBeNull();
    expect(checkReferralCode('4k7q2m')).toBeNull();
    expect(checkReferralCode('4K7Q2')?.message).toContain('exactly 6');
  });
});

describe('a rupee amount typed into a price box', () => {
  const opts = { max: 50_000, what: 'A visit fee' };

  it('takes the ways people write money', () => {
    expect(checkRupees('600', opts)).toBeNull();
    expect(checkRupees('1,200', opts)).toBeNull();
    expect(checkRupees('99.50', opts)).toBeNull();
  });

  it('catches the extra zero, which is the typo that actually happens', () => {
    expect(checkRupees('600000', opts)?.message).toContain('typo');
    expect(checkRupees('0', opts)?.message).toContain('at least');
    expect(checkRupees('₹600', opts)?.message).toContain('plain number');
  });
});

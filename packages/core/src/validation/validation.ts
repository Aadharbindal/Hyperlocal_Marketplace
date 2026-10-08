/**
 * Whether the things people type are real.
 *
 * Every rule here walks the same line, and the line is not "be strict". A validator that rejects
 * a real customer is worse than one that lets junk through: the junk costs a support ticket, the
 * false rejection costs the customer entirely, and they never tell you why they left. Indian
 * names, addresses and buildings are far more varied than any regex a developer imagines at a
 * desk - so each rule below rejects only what is *clearly* not a real answer, and the reasoning
 * for where the line sits is written next to it.
 *
 * Shared by the server and the app on purpose. The server is the authority, and the app uses the
 * same functions so somebody learns about a problem while their hands are still on the keyboard
 * rather than after a round trip.
 */

/** What is wrong, and - when we can work it out - what they probably meant. */
export interface FieldProblem {
  /** A sentence to put under the field. Written for the person, not the log. */
  message: string;
  /** Present when a near-certain correction exists, e.g. a mistyped email domain. */
  suggestion?: string;
}

// ---------------------------------------------------------------------------
// Shared junk detection
// ---------------------------------------------------------------------------

/** "aaaaaa", "1111" - a held-down key, never an answer. */
function isSingleRepeatedChar(s: string): boolean {
  const t = s.replace(/\s/g, '');
  return t.length >= 3 && new Set(t.toLowerCase()).size === 1;
}

/**
 * A run along the keyboard: asdf, qwerty, zxcv, 1234.
 *
 * Checked as a substring rather than the whole value, because the giveaway is a run *inside*
 * otherwise plausible text. Kept to runs of four or more: "as" and "qwe" appear inside real
 * words and real names.
 */
const KEYBOARD_RUNS = [
  'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'abcdefghijklmnopqrstuvwxyz', '1234567890',
];
/**
 * The same short chunk over and over: "asdasdasdasd", "abcabcabc", "121212".
 *
 * This is the gap the keyboard-run check leaves, and it is the most common junk string there is -
 * "asd" is only three characters, so a run detector looking for five in a row never sees it however
 * many times it is repeated.
 *
 * Three repeats, not two, and that line is drawn deliberately. Reduplication is ordinary in Hindi
 * and in Indian English - "dhire dhire", "chhota chhota", "jaldi jaldi" - and a two-repeat rule
 * would reject somebody writing the way they speak. Chunks of five or more are left alone for the
 * same reason, which is why "dhiredhire" never reaches this at all.
 */
function isRepeatedChunk(s: string): boolean {
  const t = s.toLowerCase().replace(/\s/g, '');
  for (let n = 2; n <= 4; n++) {
    if (t.length < n * 3 || t.length % n !== 0) continue;
    const chunk = t.slice(0, n);
    let all = true;
    for (let i = n; i < t.length; i += n) {
      if (t.slice(i, i + n) !== chunk) { all = false; break; }
    }
    if (all) return true;
  }
  return false;
}

function hasKeyboardRun(s: string, min = 4): boolean {
  const t = s.toLowerCase().replace(/\s/g, '');
  for (const row of KEYBOARD_RUNS) {
    for (let i = 0; i + min <= row.length; i++) {
      const run = row.slice(i, i + min);
      if (t.includes(run) || t.includes([...run].reverse().join(''))) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Indian mobile numbers
// ---------------------------------------------------------------------------

/**
 * Numbers that are shaped like a mobile number and are not one.
 *
 * Deliberately only all-identical digits. It is tempting to also reject 9876543210, and that
 * would be a mistake: it is a validly allocated number and somewhere there is a person holding
 * it who would be locked out of the product for having a memorable phone. Sequences are a
 * placeholder *convention*, not an invalid number, and this rule refuses junk rather than
 * policing taste.
 */
export function checkIndianMobile(nationalDigits: string): FieldProblem | null {
  if (!/^[6-9]\d{9}$/.test(nationalDigits)) {
    return { message: 'Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.' };
  }
  if (isSingleRepeatedChar(nationalDigits)) {
    return { message: 'That does not look like a real number.' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

/**
 * Domains people mean but mistype. Suggested, never auto-corrected.
 *
 * Silently fixing somebody's address is how receipts go to a stranger. The app offers the
 * correction and the person accepts it.
 */
const DOMAIN_TYPOS: Readonly<Record<string, string>> = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com',
  'gmaill.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.con': 'gmail.com',
  'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahoo.co': 'yahoo.com',
  'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com',
  'rediffmai.com': 'rediffmail.com', 'redifmail.com': 'rediffmail.com',
};

/**
 * Throwaway inboxes.
 *
 * Blocked because of what this address is *for*: receipts, and getting back into the account if
 * the phone number changes hands - which in this market it does. An address that stops existing
 * in ten minutes cannot do either, and somebody who uses one has not opted out of those, they
 * have just not thought about it. Email is optional here, so declining a disposable one costs
 * nobody access.
 */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org',
  'yopmail.com', 'throwawaymail.com', 'trashmail.com', 'fakeinbox.com', 'sharklasers.com',
  'getnada.com', 'dispostable.com', 'maildrop.cc', 'mohmal.com', 'emailondeck.com',
]);

export function checkEmail(raw: string): FieldProblem | null {
  const value = raw.trim().toLowerCase();
  if (!value) return { message: 'Enter an email address.' };

  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return { message: 'An email address needs a name, an @ and a domain.' };

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);

  // A dot at either end of the local part, or two in a row, is invalid and is almost always a slip.
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return { message: 'That address has a misplaced dot.' };
  }
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)) {
    return { message: 'That address has a character that email cannot use.' };
  }
  // A domain must have a dot and a believable last label. Two letters covers .in and .uk.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || domain.includes('..') || domain.startsWith('-')) {
    return { message: 'Check the part after the @.' };
  }

  const fix = DOMAIN_TYPOS[domain];
  if (fix) {
    return { message: `Did you mean ${local}@${fix}?`, suggestion: `${local}@${fix}` };
  }
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { message: 'Please use an address you will still have later - receipts and account recovery go here.' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Indian PIN codes
// ---------------------------------------------------------------------------

/**
 * The first digit of an Indian PIN is the postal region, and there are eight of them.
 *
 * 0 is not a region, and 9 is reserved for Army Post Office addresses, which a home-services
 * marketplace is not going to be serving. So `^[1-8]` is a real rule rather than a guess, and it
 * rejects 000000 and 999999 - between them the two most common things typed into a PIN box.
 */
export function checkPincode(raw: string): FieldProblem | null {
  const value = raw.trim();
  if (!/^\d{6}$/.test(value)) return { message: 'A PIN code is 6 digits.' };
  if (!/^[1-8]/.test(value)) return { message: 'That is not an Indian PIN code.' };
  if (isSingleRepeatedChar(value)) return { message: 'That is not a real PIN code.' };
  return null;
}

// ---------------------------------------------------------------------------
// Human names
// ---------------------------------------------------------------------------

/**
 * A name somebody would actually answer to.
 *
 * The hard part is restraint. Indian names are short ("Jo"), long, hyphenated, apostrophed,
 * single-word, and written in several scripts - so this does not check length beyond two
 * characters, does not require a surname, does not require spaces, and does not require Latin
 * letters. It rejects three things only: digits, a held-down key, and a run along the keyboard.
 */
export function checkPersonName(raw: string): FieldProblem | null {
  const value = raw.trim();
  if (value.length < 2) return { message: 'Enter your name.' };
  if (/\d/.test(value)) return { message: 'A name does not contain numbers.' };
  if (isSingleRepeatedChar(value) || hasKeyboardRun(value)) {
    return { message: 'Please enter your real name.' };
  }
  // Letters from any script, plus the punctuation names legitimately carry.
  if (!/\p{L}/u.test(value)) return { message: 'Enter your name.' };
  return null;
}

// ---------------------------------------------------------------------------
// Address lines
// ---------------------------------------------------------------------------

/** Words that make a line an address even without a number. */
const ADDRESS_WORDS = /\b(flat|house|plot|door|shop|block|tower|villa|apt|apartment|floor|road|rd|street|st|lane|marg|nagar|colony|sector|phase|society|building|bldg|gali|chowk|vihar|puram|enclave|extension|extn|layout|cross|main)\b/i;

/**
 * The first line of an address.
 *
 * A real one carries either a number or a word that means "a place" - "12, Lodhi Colony" has
 * both, "Green Park Extension" has the second, "asdasd" has neither. Two or more words also
 * passes, because people write addresses in ways no list anticipates and a line somebody took
 * the trouble to write in parts is almost never junk.
 */
export function checkAddressLine(raw: string): FieldProblem | null {
  const value = raw.trim();
  if (value.length < 4) return { message: 'Add the flat or building and the street.' };
  if (isSingleRepeatedChar(value) || hasKeyboardRun(value)) {
    return { message: 'That does not look like an address.' };
  }
  const hasNumber = /\d/.test(value);
  const hasWord = ADDRESS_WORDS.test(value);
  const hasTwoWords = value.split(/\s+/).filter((w) => w.length > 1).length >= 2;
  if (!hasNumber && !hasWord && !hasTwoWords) {
    return { message: 'Add the flat or building number, or the street name.' };
  }
  return null;
}

/** A city name. Same restraint as a person's name, and no digits. */
export function checkCity(raw: string): FieldProblem | null {
  const value = raw.trim();
  if (value.length < 2) return { message: 'Enter the city.' };
  if (/\d/.test(value)) return { message: 'A city name does not contain numbers.' };
  if (isSingleRepeatedChar(value) || hasKeyboardRun(value)) return { message: 'Enter a real city name.' };
  return null;
}

// ---------------------------------------------------------------------------
// Free text somebody will read
// ---------------------------------------------------------------------------

/**
 * A description, reason or note that a person on the other side has to act on.
 *
 * "asdasd" in a job description wastes a professional's trip; in a cancellation reason it wastes
 * a customer's goodwill. Length alone does not catch it, which is why these are checked for the
 * same junk as a name, with a minimum the caller sets.
 */
export function checkMeaningfulText(raw: string, minLength: number, what: string): FieldProblem | null {
  const value = raw.trim();
  if (value.length < minLength) {
    return { message: `${what} needs at least ${minLength} characters so the other person can act on it.` };
  }
  if (isSingleRepeatedChar(value) || isRepeatedChunk(value) || hasKeyboardRun(value, 5)) {
    return { message: `Please write ${what.toLowerCase()} in a few real words.` };
  }
  // A line with no letters at all - "123456", "......" - is not something anybody can act on.
  if (!/\p{L}/u.test(value)) return { message: `Please write ${what.toLowerCase()} in words.` };
  return null;
}

/** Everything above, as one list, for a form that wants to show all its problems at once. */
export const VALIDATORS = {
  mobile: checkIndianMobile,
  email: checkEmail,
  pincode: checkPincode,
  name: checkPersonName,
  addressLine: checkAddressLine,
  city: checkCity,
  ifsc: checkIfsc,
  bankAccountNumber: checkBankAccountNumber,
  upiVpa: checkUpiVpa,
  mobileField: checkMobileField,
  reason: checkReason,
  reviewComment: checkReviewComment,
  businessName: checkBusinessName,
  futureDateTime: checkFutureDateTime,
  referralCode: checkReferralCode,
} as const;

// ---------------------------------------------------------------------------
// Using these in a schema
// ---------------------------------------------------------------------------

/** The slice of zod's refinement context these need. Typed here so core need not import zod. */
export interface RefineCtx {
  addIssue(issue: { code: 'custom'; message: string }): void;
}

/**
 * Turns one of the checks above into a zod `superRefine` callback.
 *
 * The point of routing every schema through this is that the server and the app give the **same
 * sentence** for the same bad input. When the two disagree the app looks broken even though both
 * are working: somebody fixes what the app complained about and the server rejects it anyway.
 */
export function refineWith(check: (value: string) => FieldProblem | null) {
  return (value: string, ctx: RefineCtx) => {
    const problem = check(value);
    if (problem) ctx.addIssue({ code: 'custom', message: problem.message });
  };
}

// ---------------------------------------------------------------------------
// Where money goes
// ---------------------------------------------------------------------------

/**
 * These three are different in kind from everything above, and the difference changes the rule.
 *
 * Everywhere else a false rejection costs us a customer, so the checks lean permissive. Here a
 * false *acceptance* sends somebody's earnings to a stranger's account, and the money is gone -
 * there is no support ticket that unwinds a completed NEFT transfer to a valid account belonging to
 * the wrong person. So these lean strict, and they can afford to: unlike a name or an address, the
 * formats are specified by NPCI and the RBI rather than by how people actually live.
 *
 * What they still do not do is claim the account exists. Only the payment provider's own
 * verification can say that, and the payout screen says so out loud rather than letting a green
 * tick here imply it.
 */

/**
 * An IFSC code: four letters for the bank, a zero, six for the branch.
 *
 * The fifth character is reserved by the RBI and is always 0, which makes it the single most useful
 * check here - it catches the common transposition of a letter into position five that would
 * otherwise pass a plain eleven-character length test.
 */
export function checkIfsc(raw: string): FieldProblem | null {
  const value = raw.trim().toUpperCase();
  if (!value) return null;
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(value)) {
    return {
      message: 'An IFSC is 11 characters: four letters, then 0, then six more. It is on your cheque book and in your bank app.',
    };
  }
  return null;
}

/**
 * A bank account number.
 *
 * Nine to eighteen digits is the range Indian banks actually issue across, and there is no
 * checksum in an account number to verify against - so beyond the length the only thing worth
 * refusing is a held-down key. A real account of all one digit is possible in principle and
 * vanishingly unlikely next to a person who typed 000000000 to get past the form.
 */
export function checkBankAccountNumber(raw: string): FieldProblem | null {
  const value = raw.trim();
  if (!value) return null;
  if (!/^\d{9,18}$/.test(value)) {
    return { message: 'An account number is 9 to 18 digits, with no spaces or dashes.' };
  }
  if (isSingleRepeatedChar(value)) {
    return { message: 'Please enter your real account number - this is where your earnings will go.' };
  }
  return null;
}

/** Email domains people type into a UPI field by mistake, because the shape looks the same. */
const EMAIL_DOMAINS_IN_VPA = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'rediffmail.com', 'icloud.com']);

/**
 * A UPI id - `name@handle`.
 *
 * The one mistake worth naming specifically is `something@gmail.com`: it is the right shape, it is
 * the address the person genuinely has, and it is not a UPI id. Saying "that looks like your email"
 * is the difference between somebody fixing it in ten seconds and somebody believing our form is
 * broken because their perfectly good address was refused.
 */
export function checkUpiVpa(raw: string): FieldProblem | null {
  const value = raw.trim();
  if (!value) return null;
  const at = value.indexOf('@');
  if (at < 1 || value.indexOf('@', at + 1) !== -1) {
    return { message: 'A UPI id looks like yourname@bank - for example 9876543210@ybl.' };
  }
  const handle = value.slice(at + 1).toLowerCase();
  if (EMAIL_DOMAINS_IN_VPA.has(handle)) {
    return { message: 'That looks like your email address. A UPI id ends in a bank handle, like @ybl, @okaxis or @paytm.' };
  }
  if (!/^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z0-9.\-]{1,32}$/.test(value)) {
    return { message: 'A UPI id looks like yourname@bank - letters, numbers, dots and dashes only.' };
  }
  // A handle with a dot in it is legitimate (@okhdfcbank has none, @ibl does not either, but some
  // PSP handles do), so only a trailing or doubled dot is refused.
  if (/\.\.|\.$/.test(handle)) {
    return { message: 'Check the part after the @ - it has a stray dot.' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Named wrappers, so one sentence is written once
// ---------------------------------------------------------------------------

/**
 * A mobile number as a *field* rather than as ten clean digits.
 *
 * `checkIndianMobile` takes the national part, which is right for a schema that has already
 * normalised. A form has not: somebody pastes "+91 98100 12345", or types into a box that already
 * shows "+91", and a validator that only understood ten bare digits would call every one of those
 * wrong. Nothing about who holds which number is judged here - see `checkIndianMobile`.
 */
export function checkMobileField(raw: string): FieldProblem | null {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  // A leading 91 or 0 is how people write their own number, not part of it.
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  if (national.length < 10) return { message: 'Enter all 10 digits of the mobile number.' };
  return checkIndianMobile(national);
}

/**
 * A reason somebody on the other side has to act on: a cancellation, a reschedule, a rejection.
 *
 * Ten characters, which is about two real words. The number is low on purpose - "pipe burst" and
 * "guard refused" are complete answers, and demanding a paragraph is how you get a paragraph of
 * "asdasdasdasd" instead.
 */
export function checkReason(raw: string): FieldProblem | null {
  return checkMeaningfulText(raw, 10, 'A reason');
}

/**
 * A review somebody will read about themselves, or about work they are deciding whether to buy.
 *
 * Same minimum as a reason, and the same reasoning: "very neat work" is a review.
 */
export function checkReviewComment(raw: string): FieldProblem | null {
  return checkMeaningfulText(raw, 10, 'Your review');
}

/**
 * A business or shop name.
 *
 * Looser than a person's name in one way - digits are completely normal here ("A1 Electricals",
 * "24x7 Plumbing") - and the same in the way that matters, which is that it must not be a held-down
 * key. No script restriction: a shop named in Devanagari is a shop.
 */
export function checkBusinessName(raw: string): FieldProblem | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.length < 2) return { message: 'Enter the name your customers know you by.' };
  if (isSingleRepeatedChar(value) || hasKeyboardRun(value, 5)) {
    return { message: 'Please enter a real business name - this is what customers see.' };
  }
  if (!/\p{L}/u.test(value)) return { message: 'A business name needs at least one letter.' };
  return null;
}

// ---------------------------------------------------------------------------
// A date and time somebody typed
// ---------------------------------------------------------------------------

/** 1st, 2nd, 3rd, 4th - and 11th, 12th, 13th, 21st, which the naive version gets wrong. */
function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
}

/** How far ahead a booking may be moved. Beyond this it is a new booking, not a reschedule. */
export const MAX_RESCHEDULE_DAYS_AHEAD = 90;

/**
 * `YYYY-MM-DD HH:MM`, read as local time, checked one failure at a time.
 *
 * The point of this is the *specificity*, which is the whole difference between a form somebody can
 * finish and one they abandon. A single "use the form 2026-10-04 15:30, and pick a time in the
 * future" covers four different mistakes with one sentence, so the person who typed 31 February and
 * the person who typed yesterday both have to work out which half applies to them. Here each one is
 * told the thing that is actually wrong.
 *
 * `2026-02-31` is worth singling out: it matches the pattern perfectly and `new Date` silently rolls
 * it forward to 3 March, so without the round-trip check below somebody would be booked onto a day
 * they did not choose and would have no way of knowing.
 */
export function checkFutureDateTime(raw: string, now: Date = new Date()): FieldProblem | null {
  const value = raw.trim();
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value);
  if (!m) return { message: 'Write the date and time like 2026-10-04 15:30.' };

  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12) return { message: 'That month does not exist - months run from 01 to 12.' };
  if (h > 23 || mi > 59) return { message: 'Use a 24-hour time, so 3:30 in the afternoon is 15:30.' };

  const when = new Date(y, mo - 1, d, h, mi);
  // The round trip catches a day that does not exist in that month: JavaScript rolls 31 February
  // forward to 3 March without complaint.
  if (when.getMonth() !== mo - 1 || when.getDate() !== d) {
    return { message: `There is no ${d}${ordinalSuffix(d)} in that month.` };
  }
  if (when.getTime() <= now.getTime()) return { message: 'Pick a time that has not already passed.' };

  const daysAhead = (when.getTime() - now.getTime()) / 86_400_000;
  if (daysAhead > MAX_RESCHEDULE_DAYS_AHEAD) {
    return { message: `That is more than ${MAX_RESCHEDULE_DAYS_AHEAD} days away. Check the year, or make a fresh booking nearer the time.` };
  }
  return null;
}

/**
 * A referral code somebody read off a friend's screen, or was told over a chai.
 *
 * The generator leaves 0, 1, I and O out of its alphabet precisely so a code can be said out loud
 * without anybody having to ask "one or ell?" - which means a code containing one of them is
 * *certainly* a misread, and we can say which character to look at instead of "invalid code". That
 * sentence is the entire value of this function; the length check is incidental.
 *
 * Case is not the person's problem: the field upper-cases as they type.
 */
const REFERRAL_CODE_ALPHABET = /^[2-9A-HJ-NP-Z]{6}$/;

export function checkReferralCode(raw: string): FieldProblem | null {
  const value = raw.trim().toUpperCase();
  if (!value) return null;
  const confusable = /[01IO]/.exec(value);
  if (confusable) {
    return {
      message: `Codes never contain 0, 1, I or O - look at the "${confusable[0]}" again. It is probably an O-shaped D or Q, or an L.`,
    };
  }
  if (value.length !== 6) return { message: 'A referral code is exactly 6 characters.' };
  if (!REFERRAL_CODE_ALPHABET.test(value)) return { message: 'A referral code is 6 letters and digits, with no spaces or symbols.' };
  return null;
}

/**
 * A rupee amount typed into a price box, checked in rupees rather than paise.
 *
 * `max` is the caller's, because what counts as absurd differs: a visit fee of fifty thousand
 * rupees is a typo, the same number for a full bathroom refit is a Tuesday. What is shared is the
 * refusal of zero where zero means "I did not fill this in", and of the extra zero somebody adds by
 * holding the key down - which is the error that actually happens and that a bare `> 0` lets past.
 */
export function checkRupees(raw: string, opts: { min?: number; max: number; what: string }): FieldProblem | null {
  const value = raw.trim().replace(/[,\s]/g, '');
  if (!value) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    return { message: `${opts.what} should be a plain number of rupees - no symbols, and paise are not needed.` };
  }
  const n = Number(value);
  const min = opts.min ?? 1;
  if (n < min) return { message: `${opts.what} has to be at least ₹${min}.` };
  if (n > opts.max) {
    return { message: `₹${n.toLocaleString('en-IN')} looks like a typo - the most ${opts.what.toLowerCase()} can be is ₹${opts.max.toLocaleString('en-IN')}.` };
  }
  return null;
}

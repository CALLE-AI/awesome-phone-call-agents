/**
 * The wake-up challenge: a three-digit code, said back in reverse.
 *
 * One mechanism, every morning. CALL-E reads out a code and you say it
 * backwards, so 587 becomes 785.
 *
 * Why reversal rather than repetition or a quiz:
 *  - Repeating a code proves you can hear, not that you are awake. Reversing one
 *    cannot be done reflexively: it needs you to hold three digits in your head
 *    and walk them backwards, which is exactly the thing a sleeping brain will
 *    not do.
 *  - It is the same task every single morning, so there is nothing to learn and
 *    no rules to remember at 7am. A rotating quiz makes you parse a question
 *    first; this does not.
 *  - The answer is digits, which survives a phone transcript intact. Spoken
 *    words invite homophone mistakes ("four" against "for") that punish the user
 *    for the transcriber's error.
 *
 * Digits are what makes it fair, and also what constrains the code: see
 * randomCode for why some numbers are never issued.
 */

/**
 * A three-digit code that is safe to reverse.
 *
 * Two families are excluded, both because they make the task unfalsifiable:
 *  - Palindromes (121, 767): the reverse equals the code, so reading it straight
 *    back passes. A sleeping person gets it right by doing nothing.
 *  - Codes with a trailing zero (580): the reverse (085) loses its leading zero
 *    the moment anyone says or types it, so a correct answer looks wrong.
 *
 * That leaves 720 of the 900 three-digit numbers.
 */
function randomCode() {
  for (;;) {
    const n = 100 + Math.floor(Math.random() * 900);
    const s = String(n);
    if (s[2] === '0') continue;                 // reverse would start with 0
    if (s === [...s].reverse().join('')) continue; // palindrome: reverse is itself
    return s;
  }
}

/** The answer we expect: the code, backwards. */
function reverseCode(code) {
  return [...String(code)].reverse().join('');
}

/** Digits as words, so a transcript that spells them out still grades. */
const DIGIT_WORDS = {
  zero: '0', oh: '0', nought: '0',
  one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};

/**
 * Grade a spoken or typed answer.
 *
 * Generous on purpose, because this is graded off a phone transcript from
 * someone barely conscious. Number words are converted to digits first, then
 * everything that is not a digit is discarded, so "785", "7-8-5",
 * "seven eight five" and "it's 785" all pass. Only the digits and their order
 * decide.
 *
 * On the call CALL-E does its own grading against the answer written into the
 * prompt; this runs for the website, and for the transcript we store.
 */
function checkAnswer(code, given) {
  if (given === null || given === undefined) return false;

  const digits = String(given)
    .toLowerCase()
    .replace(/[a-z]+/g, (word) => DIGIT_WORDS[word] ?? ' ')
    .replace(/\D/g, '');

  if (!digits) return false;
  return digits === reverseCode(code);
}

module.exports = { randomCode, reverseCode, checkAnswer };

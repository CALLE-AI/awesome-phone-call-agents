// Every phone number this app ships — seed data, test fixtures, docs, samples — must be one
// regulators reserve for fiction. Checked against the same FICTIONAL_RANGES table
// CallEProvider uses to refuse live dials, so "fictional in the repo" and "refused live"
// cannot drift apart. What the scan covers is exactly tests/helpers/repo-numbers.js:
// internationally written numbers ("+" or "00" prefix). A national spelling with no prefix
// ("020 7946 0958") is not detected by it.
const { FICTIONAL_RANGES, isFictionalNumber } = require('../src/fictional-numbers');
const { maskPhone } = require('../src/mask');
const { scan, findNumbers } = require('./helpers/repo-numbers');

describe('every phone number in this app is reserved for fiction', () => {
  const found = scan();

  test('the scan actually sees the app (not vacuously green)', () => {
    const where = new Set(found.map((f) => f.where.split(':')[0]));
    expect([...where]).toEqual(expect.arrayContaining(['src/store.js', 'tests/providers.test.js', 'docs/submission-checklist.md']));
  });

  test('no number outside FICTIONAL_RANGES', () => {
    const offenders = found
      .filter((f) => !isFictionalNumber(f.number))
      .map((f) => `${f.where} ${maskPhone(f.number)}`);
    expect(offenders).toEqual([]);
  });

  test('the scan sees a number however it is typed', () => {
    expect(findNumbers('call \uFF0B1 202 555 0147 now')).toHaveLength(1);
    expect(findNumbers('call +1\u2011202\u2011555\u20110147 now')).toHaveLength(1);
    expect(findNumbers('call +\u0661\u0662\u0660\u0662\u0665\u0665\u0665\u0660\u0661\u0664\u0667 now')).toHaveLength(1);
    expect(findNumbers('call 0044 20 7946 0958 now')).toHaveLength(1);
    expect(findNumbers('translate(68.0081, 0012)')).toHaveLength(0);
  });

  test.each([
    ['NANP short seed form', '+1-555-0100'],
    ['NANP 555-01xx, geographic area code', '+1 202 555 0147'],
    ['NANP 555-01xx, another geographic code', '+1 801 555 0100'],
    ['London drama block', '+44 20 7946 0958'],
    ['London, with (0)', '+44 (0)20 7946 0958'],
    ['London, with a trunk 0', '+44 020 7946 0958'],
    ['mobile drama block', '+44 7700 900123'],
    ['0113-0118 block', '+44 113 496 0000'],
    ['0161 block', '+44 161 496 0999'],
    ['Tyneside block (area 0191, exchange 498)', '+44 191 498 0123'],
    ['Belfast block', '+44 28 9649 6000'],
    ['Cardiff block', '+44 29 2018 0000'],
    ['01632 block', '+44 1632 960000'],
    ['freephone block', '+44 808 157 0000'],
    ['premium block', '+44 909 879 0000'],
    ['UK-wide block', '+44 306 999 0000']
  ])('reserved: %s', (_label, number) => {
    expect(isFictionalNumber(number)).toBe(true);
  });

  // The "not reserved" cases are built here, at run time, by moving one digit of a reserved
  // number out of its block — so no number that might belong to a real line is ever written
  // into this repository. Titles name the case, never the number.
  const withDigits = (reserved, changes) => {
    const digits = [...reserved.replace(/\D/g, '')];
    Object.entries(changes).forEach(([index, digit]) => {
      digits[index] = digit;
    });
    return `+${digits.join('')}`;
  };
  test.each([
    ['NANP line outside the 01xx block', withDigits('+12025550147', { 8: '2' })],
    ['NANP toll-free 800', withDigits('+12025550147', { 1: '8', 2: '0', 3: '0' })],
    ['NANP toll-free 888', withDigits('+12025550147', { 1: '8', 2: '8', 3: '8' })],
    ['NANP toll-free 833', withDigits('+12025550147', { 1: '8', 2: '3', 3: '3' })],
    ['London outside the drama block', withDigits('+442079460958', { 8: '1' })],
    ['mobile outside the drama block', withDigits('+447700900123', { 8: '1' })],
    ['Tyneside exchange 496 (the drama block is 498)', withDigits('+441914980123', { 7: '6' })],
    ['one digit too long', `${'+12025550147'}0`],
    ['one digit too short', '+12025550147'.slice(0, -1)]
  ])('not reserved: %s', (_label, number) => {
    expect(isFictionalNumber(number)).toBe(false);
  });

  test('an "00" international prefix reads as "+"', () => {
    expect(isFictionalNumber('0044 20 7946 0958')).toBe(true);
  });

  test('every range is labelled', () => {
    FICTIONAL_RANGES.forEach((range) => expect(range.label).toEqual(expect.any(String)));
  });
});

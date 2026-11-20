import { describe, expect, it } from 'vitest';
import { disallowedNumbers, extractNumbers, isAllowed } from '../src/numbers.js';

const vals = (t: string, ignore: string[] = []) => extractNumbers(t, ignore).map((n) => [n.raw, n.value, n.kind]);

describe('extractNumbers', () => {
  it('integers, decimals, thousands separators, leading-dot decimals', () => {
    expect(vals('It ran 12 times, 3.5 hours, 1,200 events and .5 more.')).toEqual([
      ['12', 12, 'number'],
      ['3.5', 3.5, 'number'],
      ['1,200', 1200, 'number'],
      ['.5', 0.5, 'number'],
    ]);
  });

  it('percentages, spaced or not', () => {
    expect(vals('72% sure, 15 % of time')).toEqual([
      ['72%', 72, 'percent'],
      ['15 %', 15, 'percent'],
    ]);
  });

  it('unit suffixes do not hide numbers', () => {
    expect(vals('3.5h, 12 hrs, 12hrs, 2x faster, 40min').map((x) => x[1])).toEqual([3.5, 12, 12, 2, 40]);
  });

  it('k suffix multiplies', () => {
    expect(vals('about 5k events')).toEqual([['5k', 5000, 'number']]);
  });

  it('ordinals are numbers', () => {
    expect(vals('the 3rd and 21st time')).toEqual([
      ['3rd', 3, 'ordinal'],
      ['21st', 21, 'ordinal'],
    ]);
  });

  it('identifiers with a leading letter are skipped', () => {
    expect(vals('Q3 report, B2B leads, S3 bucket')).toEqual([]);
  });

  it('a list "3,4" is two numbers, "1,2345" is not a thousands group', () => {
    expect(vals('steps 3,4').map((x) => x[1])).toEqual([3, 4]);
    expect(vals('1,2345').map((x) => x[1])).toEqual([1, 2345]);
  });

  it('ranges and times split', () => {
    expect(vals('3-5 times at 9:15').map((x) => x[1])).toEqual([3, 5, 9, 15]);
  });

  it('a sentence-final period is not a decimal point', () => {
    expect(vals('It took 7.')).toEqual([['7', 7, 'number']]);
  });

  it('number words except "one" and ordinal words', () => {
    expect(vals('One of two steps, twelve times, a dozen days, the first and second run').map((x) => x[1])).toEqual([2, 12, 12]);
  });

  it('masks names that contain digits', () => {
    expect(vals('Use 1Password Connect and Office 365 for 4 steps', ['1Password Connect', 'office 365'])).toEqual([['4', 4, 'number']]);
  });
});

describe('isAllowed', () => {
  it('requires exact equality, no rounding', () => {
    expect(isAllowed({ value: 3.9, kind: 'number' }, [3.94])).toBe(false);
    expect(isAllowed({ value: 3.9, kind: 'number' }, [3.9])).toBe(true);
    expect(isAllowed({ value: 4, kind: 'number' }, [3.9])).toBe(false);
  });
  it('trailing zeros are fine', () => {
    expect(disallowedNumbers('3.50 hours', [3.5])).toEqual([]);
  });
  it('percent matches a 0..1 fraction or the percentage', () => {
    expect(isAllowed({ value: 72, kind: 'percent' }, [0.72])).toBe(true);
    expect(isAllowed({ value: 72, kind: 'percent' }, [72])).toBe(true);
    expect(isAllowed({ value: 72, kind: 'number' }, [0.72])).toBe(false);
  });
  it('flags words against the list too', () => {
    expect(disallowedNumbers('three times', [3])).toEqual([]);
    expect(disallowedNumbers('four times', [3]).map((n) => n.raw)).toEqual(['four']);
  });
});

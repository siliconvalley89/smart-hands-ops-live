import { describe, expect, it } from 'vitest';
import { csvCell } from '../../src/lib/csv';

describe('csvCell', () => {
  it('wraps values in quotes', () => {
    expect(csvCell('Acme')).toBe('"Acme"');
    expect(csvCell(42)).toBe('"42"');
  });

  it('escapes embedded double quotes', () => {
    expect(csvCell('said "hi"')).toBe('"said ""hi"""');
  });

  it('keeps commas and newlines inside a single quoted cell', () => {
    expect(csvCell('Dock 4, north\nside')).toBe('"Dock 4, north\nside"');
  });

  it('writes null and undefined as empty cells', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it('keeps zero as zero', () => {
    expect(csvCell(0)).toBe('"0"');
  });

  it('neutralizes text that spreadsheets would read as a formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1 555')).toBe(`"'+1 555"`);
    expect(csvCell('-Dock 4')).toBe(`"'-Dock 4"`);
    expect(csvCell('@cmd')).toBe(`"'@cmd"`);
  });

  it('leaves numeric values unchanged, including negatives', () => {
    expect(csvCell(-5)).toBe('"-5"');
    expect(csvCell(12.5)).toBe('"12.5"');
  });
});

import { describe, expect, it } from 'vitest';
import { isFieldRole, roleLabel } from '../../src/lib/roles';

describe('roleLabel', () => {
  it('labels the staff roles people read on screen', () => {
    expect(roleLabel('adminAssistant')).toBe('Admin Assistant');
    expect(roleLabel('seniorConsultant')).toBe('Senior Consultant');
  });

  it('passes other roles through unchanged', () => {
    expect(roleLabel('admin')).toBe('admin');
    expect(roleLabel(undefined)).toBeUndefined();
  });
});

describe('isFieldRole', () => {
  it('treats technicians and senior consultants as field staff', () => {
    expect(isFieldRole('tech')).toBe(true);
    expect(isFieldRole('seniorConsultant')).toBe(true);
    expect(isFieldRole('adminAssistant')).toBe(false);
  });
});

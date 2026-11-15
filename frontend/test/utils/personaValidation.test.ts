import { validateManualPersona, validateSource } from '@/utils/personaValidation';

const ok = { name: 'Dana', role: 'VP', companyContext: '', mainPain: 'Churn', skepticism: 'Price', style: '' };

describe('persona validation', () => {
  it('accepts a minimal manual persona', () => {
    expect(validateManualPersona(ok)).toEqual({});
  });
  it('requires name, role, pain and skepticism but not context or style', () => {
    const errors = validateManualPersona({ ...ok, name: ' ', role: '', mainPain: '', skepticism: '' });
    expect(Object.keys(errors).sort()).toEqual(['mainPain', 'name', 'role', 'skepticism']);
  });
  it('enforces backend length caps', () => {
    expect(validateManualPersona({ ...ok, mainPain: 'a'.repeat(1001) }).mainPain).toBeDefined();
    expect(validateManualPersona({ ...ok, skepticism: 'a'.repeat(501) }).skepticism).toBeDefined();
    expect(validateManualPersona({ ...ok, style: 'a'.repeat(201) }).style).toBeDefined();
  });
  it('requires the field matching the source kind', () => {
    const none = { pastedText: '', url: '', uploadReady: false };
    expect(validateSource('pasted_text', none)).toBeDefined();
    expect(validateSource('url', none)).toBeDefined();
    expect(validateSource('upload', none)).toBeDefined();
    expect(validateSource('upload', { ...none, uploadReady: true })).toBeUndefined();
  });
  it('validates url shape and pasted text size', () => {
    const base = { pastedText: '', url: '', uploadReady: false };
    expect(validateSource('url', { ...base, url: 'not a url' })).toBeDefined();
    expect(validateSource('url', { ...base, url: 'ftp://x.com' })).toBeDefined();
    expect(validateSource('url', { ...base, url: 'https://acme.com' })).toBeUndefined();
    expect(validateSource('pasted_text', { ...base, pastedText: 'a'.repeat(20001) })).toBeDefined();
  });
});

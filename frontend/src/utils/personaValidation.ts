import type { PersonaSourceKind } from '@/types/api';

export const PERSONA_LIMITS = {
  name: 120,
  role: 120,
  companyContext: 500,
  mainPain: 1000,
  skepticism: 500,
  style: 200,
  pastedText: 20000,
} as const;

function required(value: string, max: number, label: string): string | undefined {
  const n = value.trim().length;
  if (n === 0) return `${label} is required`;
  if (n > max) return `${label} must be ${max} characters or fewer`;
  return undefined;
}

function optional(value: string, max: number, label: string): string | undefined {
  return value.trim().length > max ? `${label} must be ${max} characters or fewer` : undefined;
}

export interface ManualPersonaFields {
  name: string;
  role: string;
  companyContext: string;
  mainPain: string;
  skepticism: string;
  style: string;
}

export function validateManualPersona(f: ManualPersonaFields): Partial<Record<keyof ManualPersonaFields, string>> {
  const errors: Partial<Record<keyof ManualPersonaFields, string>> = {
    name: required(f.name, PERSONA_LIMITS.name, 'Name'),
    role: required(f.role, PERSONA_LIMITS.role, 'Role'),
    companyContext: optional(f.companyContext, PERSONA_LIMITS.companyContext, 'Company context'),
    mainPain: required(f.mainPain, PERSONA_LIMITS.mainPain, 'Main pain'),
    skepticism: required(f.skepticism, PERSONA_LIMITS.skepticism, 'Skepticism'),
    style: optional(f.style, PERSONA_LIMITS.style, 'Communication style'),
  };
  for (const key of Object.keys(errors) as (keyof ManualPersonaFields)[]) {
    if (!errors[key]) delete errors[key];
  }
  return errors;
}

/**
 * The backend does not enforce that the field matching source_kind is
 * present (architecture doc §11 item 2), so the client must.
 */
export function validateSource(
  kind: PersonaSourceKind,
  input: { pastedText: string; url: string; uploadReady: boolean },
): string | undefined {
  switch (kind) {
    case 'pasted_text':
      return required(input.pastedText, PERSONA_LIMITS.pastedText, 'Pasted text');
    case 'url': {
      const value = input.url.trim();
      if (!value) return 'Website address is required';
      try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Enter a valid http(s) address';
      } catch {
        return 'Enter a valid address, e.g. https://example.com';
      }
      return undefined;
    }
    case 'upload':
      return input.uploadReady ? undefined : 'Choose a document to upload';
  }
}

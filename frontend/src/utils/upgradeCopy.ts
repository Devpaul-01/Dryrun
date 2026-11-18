import type { FeatureGateError } from '@/types/api';

export interface UpgradeCopy {
  title: string;
  body: string;
}

/** Plan-aware copy for each backend gate code; falls back to the server's own message. */
export function upgradeCopy(gate: FeatureGateError): UpgradeCopy {
  const plan = gate.details?.plan ? ` on the ${capitalise(gate.details.plan)} plan` : '';
  const limit = gate.details?.limit;
  switch (gate.error) {
    case 'SESSION_LIMIT_REACHED':
      return {
        title: "You've used this month's practice sessions",
        body: limit ? `Your plan includes ${limit} sessions a month. Upgrade for unlimited practice.` : `You've reached your session limit${plan}. Upgrade for unlimited practice.`,
      };
    case 'PLAYBOOK_LIMIT_REACHED':
      return {
        title: 'Playbook limit reached',
        body: limit ? `Your plan includes ${limit} playbook${limit === 1 ? '' : 's'}. Upgrade to keep building your library.` : `You've reached your playbook limit${plan}. Upgrade to create more.`,
      };
    case 'PERSONA_FROM_DOCUMENT_NOT_INCLUDED':
      return { title: 'Build buyers from documents', body: `Creating a buyer from a document isn't included${plan}. Upgrade to turn call notes and briefs into practice partners.` };
    case 'VOICE_MODE_NOT_INCLUDED':
      return { title: 'Voice mode', body: `Voice practice isn't included${plan}.` };
    default:
      return { title: 'Upgrade to continue', body: gate.message || 'This feature is not included in your current plan.' };
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

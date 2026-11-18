import { upgradeCopy } from '@/utils/upgradeCopy';

describe('upgradeCopy', () => {
  it('mentions the limit for session gates', () => {
    const c = upgradeCopy({ error: 'SESSION_LIMIT_REACHED', message: 'm', details: { plan: 'free', limit: 4 } });
    expect(c.body).toContain('4 sessions');
  });
  it('pluralises playbook limits', () => {
    expect(upgradeCopy({ error: 'PLAYBOOK_LIMIT_REACHED', message: 'm', details: { plan: 'free', limit: 1 } }).body).toContain('1 playbook.');
  });
  it('names the plan for document personas', () => {
    expect(upgradeCopy({ error: 'PERSONA_FROM_DOCUMENT_NOT_INCLUDED', message: 'm', details: { plan: 'free' } }).body).toContain('Free plan');
  });
  it('tolerates a missing details object', () => {
    expect(() => upgradeCopy({ error: 'VOICE_MODE_NOT_INCLUDED', message: 'm' } as never)).not.toThrow();
  });
});

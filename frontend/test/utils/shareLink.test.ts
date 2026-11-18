import { buildPlaybookShareUrl } from '@/utils/shareLink';

describe('buildPlaybookShareUrl', () => {
  it('falls back to the app deep link without a share origin', () => {
    expect(buildPlaybookShareUrl('abc_-1', '')).toBe('dryrun://playbook/abc_-1');
  });
  it('uses the https origin when configured, ignoring trailing slashes', () => {
    expect(buildPlaybookShareUrl('abc', 'https://dryrun.app/')).toBe('https://dryrun.app/playbook/abc');
  });
  it('encodes unsafe token characters', () => {
    expect(buildPlaybookShareUrl('a/b', '')).toBe('dryrun://playbook/a%2Fb');
  });
});

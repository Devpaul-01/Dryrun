import { memberActions } from '@/utils/memberActions';

describe('memberActions', () => {
  it('gives members nothing', () => {
    expect(memberActions('member', 'me', { user_id: 'x', role: 'member' })).toEqual([]);
  });
  it('lets an owner promote, transfer and remove a member', () => {
    expect(memberActions('owner', 'me', { user_id: 'x', role: 'member' })).toEqual(['make_admin', 'transfer', 'remove']);
    expect(memberActions('owner', 'me', { user_id: 'x', role: 'admin' })).toEqual(['make_member', 'transfer', 'remove']);
  });
  it('lets an admin only remove', () => {
    expect(memberActions('admin', 'me', { user_id: 'x', role: 'member' })).toEqual(['remove']);
  });
  it('never offers actions on yourself or the owner', () => {
    expect(memberActions('owner', 'me', { user_id: 'me', role: 'owner' })).toEqual([]);
    expect(memberActions('admin', 'me', { user_id: 'o', role: 'owner' })).toEqual([]);
  });
});

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as userApi from '@/api/user';
import type { NotificationPreferences } from '@/api/user';
import { ME_QUERY_KEY, useLogout } from '@/hooks/useAuth';
import type { User } from '@/types/api';

export const PREFS_KEY = ['notification-preferences'] as const;

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (displayName: string) => userApi.updateProfile(displayName),
    onSuccess: (user) => queryClient.setQueryData<User>(ME_QUERY_KEY, (prev) => (prev ? { ...prev, ...user } : user)),
  });
}

export function useNotificationPreferences() {
  return useQuery({ queryKey: PREFS_KEY, queryFn: userApi.getNotificationPreferences });
}

/** Optimistic toggle: flips immediately and rolls back if the PATCH fails. */
export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<NotificationPreferences>) => userApi.updateNotificationPreferences(patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: PREFS_KEY });
      const previous = queryClient.getQueryData<NotificationPreferences>(PREFS_KEY);
      queryClient.setQueryData<NotificationPreferences>(PREFS_KEY, (prev) => (prev ? { ...prev, ...patch } : prev));
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(PREFS_KEY, ctx.previous);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: PREFS_KEY }),
  });
}

export function useRequestDataExport() {
  return useMutation({ mutationFn: () => userApi.requestDataExport() });
}

/** Deletes the account, then signs out locally (the next login offers recovery within the grace period). */
export function useDeleteAccount() {
  const logout = useLogout();
  return useMutation({
    mutationFn: () => userApi.deleteAccount(),
    onSuccess: () => logout.mutate(undefined),
  });
}

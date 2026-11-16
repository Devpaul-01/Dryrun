import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import * as sessionsApi from '@/api/sessions';
import { sessionKey } from '@/hooks/useSessions';
import { useLastSessionStore } from '@/stores/lastSessionStore';

/**
 * Cold-start recovery (architecture doc §4.5): if a session was in progress
 * when the app last ran, fetch it and resume the live screen; if it has
 * ended in the meantime, drop the pointer and go to its debrief. Runs once
 * per app launch, from the authenticated shell only.
 */
export function useSessionRecovery() {
  const router = useRouter();
  const pathname = usePathname();
  const initialPath = useRef(pathname);
  const queryClient = useQueryClient();
  const attempted = useRef(false);

  useEffect(() => {
    const pointer = useLastSessionStore.getState().lastActiveSessionId;
    if (attempted.current || !pointer) return;
    attempted.current = true;

    void sessionsApi
      .getSession(pointer)
      .then((session) => {
        queryClient.setQueryData(sessionKey(session.id), session);
        // Already launched directly onto this session (deep link / web reload): nothing to resume into.
        const alreadyThere = initialPath.current.includes(`/session/${session.id}`);
        if (session.status === 'active') {
          if (!alreadyThere) router.push(`/(app)/session/${session.id}/live`);
        } else {
          void useLastSessionStore.getState().clear();
          if (session.status === 'completed' && !alreadyThere) router.push(`/(app)/session/${session.id}/debrief`);
        }
      })
      .catch(() => {
        // Gone (404/403) or unreachable: forget a pointer we can't resolve only when the server said so.
      });
  }, [router, queryClient]);
}

import { useMutation } from '@tanstack/react-query';

import * as demoApi from '@/api/demo';
import type { DemoCategory } from '@/api/demo';
import { useDemoStore } from '@/stores/demoStore';
import { getDemoFingerprint } from '@/utils/demoFingerprint';

export function useStartDemo() {
  const begin = useDemoStore((s) => s.begin);
  return useMutation({
    mutationFn: async (category: DemoCategory) => {
      const res = await demoApi.startDemo(await getDemoFingerprint(), category);
      begin(res.token, res.persona, category);
      return res;
    },
  });
}

export function useSendDemoMessage() {
  const { addUser, addBuyer, dropLastUser } = useDemoStore.getState();
  return useMutation({
    mutationFn: async ({ token, content }: { token: string; content: string }) => {
      addUser(content);
      try {
        const res = await demoApi.sendDemoMessage(token, content);
        addBuyer(res.reply, res.messages_remaining);
        return res;
      } catch (e) {
        dropLastUser(); // the turn never happened server-side; let the user resend it
        throw e;
      }
    },
  });
}

export const useEndDemo = () => useMutation({ mutationFn: (token: string) => demoApi.endDemo(token) });

export const useConvertDemo = () =>
  useMutation({ mutationFn: (v: { token: string; email: string; password: string }) => demoApi.convertDemo(v.token, v.email, v.password) });

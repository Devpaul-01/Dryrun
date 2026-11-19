import * as WebBrowser from 'expo-web-browser';
import { useCallback, useRef, useState } from 'react';

import { useConfirmCheckout, useStartCheckout } from '@/hooks/useBilling';

export type CheckoutPhase = 'idle' | 'opening' | 'verifying' | 'success' | 'unverified' | 'error';

const VERIFY_ATTEMPTS = 4;
const VERIFY_DELAY_MS = 2500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Hosted-checkout flow (billing.routes.ts): POST /billing/checkout returns the
 * provider's page; we open it in the system browser, and when the user comes
 * back we ask the backend to verify the transaction (GET /checkout/:ref/status,
 * 400 until the provider reports success), retrying briefly because the
 * provider can lag the redirect. The backend's redirect target is a web URL,
 * so the app can't intercept it — returning to the app is the signal.
 */
export function useCheckoutFlow() {
  const start = useStartCheckout();
  const confirm = useConfirmCheckout();
  const [phase, setPhase] = useState<CheckoutPhase>('idle');
  const [txRef, setTxRef] = useState<string | null>(null);
  const busy = useRef(false);

  const verify = useCallback(
    async (ref: string): Promise<boolean> => {
      setTxRef(ref);
      setPhase('verifying');
      for (let i = 0; i < VERIFY_ATTEMPTS; i++) {
        try {
          await confirm.mutateAsync(ref);
          setPhase('success');
          return true;
        } catch (e) {
          const status = (e as { status?: number }).status;
          // 400 = provider hasn't confirmed payment (yet); anything else is a real failure.
          if (status !== 400) {
            setPhase('error');
            return false;
          }
          if (i < VERIFY_ATTEMPTS - 1) await sleep(VERIFY_DELAY_MS);
        }
      }
      setPhase('unverified');
      return false;
    },
    [confirm],
  );

  const begin = useCallback(
    async (planKey: string) => {
      if (busy.current) return;
      busy.current = true;
      try {
        setPhase('opening');
        const { checkout_url, provider_tx_ref } = await start.mutateAsync(planKey);
        setTxRef(provider_tx_ref);
        await WebBrowser.openBrowserAsync(checkout_url);
        await verify(provider_tx_ref);
      } catch {
        setPhase('error');
      } finally {
        busy.current = false;
      }
    },
    [start, verify],
  );

  const reset = useCallback(() => setPhase('idle'), []);
  return { phase, txRef, begin, verify, reset, starting: start.isPending };
}

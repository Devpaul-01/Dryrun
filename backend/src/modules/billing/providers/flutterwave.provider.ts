import axios from 'axios';
import { createHash } from 'crypto';
import { env } from '../../../config/env';
import { createLogger } from '../../../config/logger';
import {
  PaymentProvider,
  ProviderCustomerRef,
  CheckoutRef,
  VerificationResult,
  RefundResult,
} from '../paymentProvider.interface';

const log = createLogger('flutterwave-provider');
const BASE_URL = 'https://api.flutterwave.com/v3';

/**
 * Flutterwave's recurring-billing support is NOT uniform across payment
 * methods/countries — tokenized card re-charge works for many card
 * schemes, but bank transfer and mobile money generally don't support
 * silent recurring re-charge the same way. This is why `chargeRenewal`
 * is a distinct, explicit method rather than something implicitly handled
 * by a provider-side "subscription" object — renewal is orchestrated by
 * an explicit scheduled job (jobs/workers/attemptRenewalCharge.worker.ts),
 * never assumed to happen automatically on Flutterwave's side.
 */
export const flutterwaveProvider: PaymentProvider = {
  name: 'flutterwave',

  async createCustomer(email: string, name: string): Promise<ProviderCustomerRef> {
    // Flutterwave does not require pre-creating a customer object the way
    // Stripe does — the customer is implicit in each charge's payload. We
    // use the email as the stable reference.
    return { providerCustomerId: email };
  },

  async initiateCharge(input): Promise<CheckoutRef> {
    const txRef = `dryrun-${input.planKey}-${Date.now()}`;
    const response = await axios.post(
      `${BASE_URL}/payments`,
      {
        tx_ref: txRef,
        amount: input.amount,
        currency: input.currency,
        redirect_url: input.redirectUrl,
        customer: { email: input.customerRef.providerCustomerId },
        customizations: { title: 'DryRun Subscription' },
      },
      { headers: { Authorization: `Bearer ${env.flutterwave.secretKey}` } }
    );
    return { checkoutUrl: response.data.data.link, providerTxRef: txRef };
  },

  async verifyTransaction(providerTxRef: string): Promise<VerificationResult> {
    try {
      const response = await axios.get(`${BASE_URL}/transactions/verify_by_reference`, {
        params: { tx_ref: providerTxRef },
        headers: { Authorization: `Bearer ${env.flutterwave.secretKey}` },
      });
      const data = response.data?.data;
      if (data?.status !== 'successful') {
        return { success: false };
      }
      return {
        success: true,
        providerTxId: String(data.id),
        amount: data.amount,
        currency: data.currency,
        cardToken: data.card?.token, // present only for tokenizable card charges
      };
    } catch (err) {
      log.error({ err, providerTxRef }, 'Flutterwave transaction verification failed');
      return { success: false };
    }
  },

  async chargeRenewal(cardToken: string, amount: number, currency: string): Promise<VerificationResult> {
    const txRef = `dryrun-renewal-${Date.now()}`;
    try {
      const response = await axios.post(
        `${BASE_URL}/tokenized-charges`,
        { token: cardToken, currency, amount, email: 'billing@dryrun.app', tx_ref: txRef },
        { headers: { Authorization: `Bearer ${env.flutterwave.secretKey}` } }
      );
      if (response.data?.status !== 'success') return { success: false };
      return await flutterwaveProvider.verifyTransaction(txRef);
    } catch (err) {
      log.warn({ err }, 'Tokenized renewal charge failed — likely a payment method without recurring support');
      return { success: false };
    }
  },

  async cancelSubscription(): Promise<void> {
    // No provider-side subscription object to cancel (see class comment) —
    // cancellation is purely a local `subscriptions.status` transition,
    // handled in billing.service.ts.
  },

  async refund(providerTxId: string): Promise<RefundResult> {
    try {
      await axios.post(
        `${BASE_URL}/transactions/${providerTxId}/refund`,
        {},
        { headers: { Authorization: `Bearer ${env.flutterwave.secretKey}` } }
      );
      return { success: true };
    } catch (err) {
      log.error({ err, providerTxId }, 'Refund failed');
      return { success: false };
    }
  },

  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    // Flutterwave sends a pre-shared hash in the verif-hash header, compared
    // directly (not HMAC-computed from the body) — constant-time compare
    // to avoid a timing side-channel.
    const expected = env.flutterwave.webhookSecretHash;
    if (!expected) return false;
    return timingSafeEqualStrings(signatureHeader, expected);
  },
};

function timingSafeEqualStrings(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  if (hashA.length !== hashB.length) return false;
  let diff = 0;
  for (let i = 0; i < hashA.length; i++) diff |= hashA[i] ^ hashB[i];
  return diff === 0;
}

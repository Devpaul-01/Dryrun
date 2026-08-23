export interface ProviderCustomerRef {
  providerCustomerId: string;
}

export interface CheckoutRef {
  checkoutUrl: string;
  providerTxRef: string;
}

export interface VerificationResult {
  success: boolean;
  providerTxId?: string;
  amount?: number;
  currency?: string;
  cardToken?: string; // present only when the payment method supports tokenized recurring charge
}

export interface RefundResult {
  success: boolean;
}

/**
 * Flutterwave is the first concrete implementation. Application code
 * (billing.service / webhook handling / renewal job) never calls the
 * Flutterwave SDK/API directly — only this interface. A second provider
 * (Stripe/Paystack) is added later purely by implementing this contract;
 * no billing logic elsewhere changes (architecture doc §14.1).
 */
export interface PaymentProvider {
  name: string;
  createCustomer(email: string, name: string): Promise<ProviderCustomerRef>;
  initiateCharge(input: {
    customerRef: ProviderCustomerRef;
    amount: number;
    currency: string;
    planKey: string;
    redirectUrl: string;
  }): Promise<CheckoutRef>;
  verifyTransaction(providerTxRef: string): Promise<VerificationResult>;
  /**
   * Charges a stored token for a renewal. Throws with a distinct error if
   * the original payment method does not support tokenized recurring
   * charge (bank transfer, some mobile money) — callers must handle that
   * case by falling back to a payment-reminder flow, not treat it as a
   * generic failure (architecture doc §14.2).
   *
   * FIX (MED-4): now takes the real customer email explicitly, matching
   * initiateCharge's use of the real customer email — the Flutterwave
   * implementation used to hardcode a placeholder address for every
   * renewal charge regardless of who was actually being billed.
   */
  chargeRenewal(cardToken: string, amount: number, currency: string, customerEmail: string): Promise<VerificationResult>;
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
  refund(providerTxId: string): Promise<RefundResult>;
  /**
   * FIX (audit finding L1): the parameter here was previously named
   * `rawBody` and typed `string`, implying a byte-exact guarantee this
   * codebase's only current implementation (Flutterwave) neither needs
   * nor receives — webhook.routes.ts passes an already-parsed-then-
   * reserialized `JSON.stringify(req.body)`, and flutterwaveProvider's
   * own implementation never actually reads this parameter at all: it
   * compares the `verif-hash` header directly against a static
   * pre-shared secret, with no HMAC-over-body computation. That's not a
   * live bug for Flutterwave specifically, but the old name/type
   * implied a contract this codebase doesn't actually uphold today.
   *
   * If a FUTURE provider needs true HMAC-over-body verification (unlike
   * Flutterwave), it will need its own raw-body mount ahead of the
   * global express.json() middleware — see modules/auth/emailHook.
   * routes.ts's own header comment for exactly why re-serialized JSON
   * isn't a safe substitute for the original request bytes, and for the
   * express.raw() mounting pattern that provider's webhook route would
   * need to follow (webhook.routes.ts is not currently mounted this way).
   */
  verifyWebhookSignature(bodyForVerification: string, signatureHeader: string | undefined): boolean;
}

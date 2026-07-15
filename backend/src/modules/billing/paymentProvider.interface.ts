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
   */
  chargeRenewal(cardToken: string, amount: number, currency: string): Promise<VerificationResult>;
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
  refund(providerTxId: string): Promise<RefundResult>;
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean;
}

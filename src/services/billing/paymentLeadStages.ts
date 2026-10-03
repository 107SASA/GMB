/**
 * Pure helpers for platform Lead stage transitions around Razorpay payment.
 * Used by customerActivation + the webhook failure path so tests can assert
 * stage order without a live payment network call.
 */

/** Stages that must not be overwritten by a failed/halted payment. */
const TERMINAL_SUCCESS = new Set(['CUSTOMER', 'PAYMENT_VERIFIED']);

/**
 * On payment.failed / subscription.halted: move to CONVERSION_PENDING unless
 * the lead is already a verified customer. Never invents CUSTOMER.
 */
export function stageOnPaymentFailure(
  currentStage: string | null | undefined
): 'CONVERSION_PENDING' | null {
  if (!currentStage) return 'CONVERSION_PENDING';
  if (TERMINAL_SUCCESS.has(currentStage)) return null;
  if (currentStage === 'DO_NOT_CONTACT' || currentStage === 'LOST') return null;
  if (currentStage === 'CONVERSION_PENDING') return null;
  return 'CONVERSION_PENDING';
}

/**
 * Success path order: PAYMENT_VERIFIED first (after workspace activation),
 * then CUSTOMER / IN_HOUSE after invoice/welcome helpers. Never CUSTOMER first.
 */
export function paymentSuccessStageSequence(): readonly ['PAYMENT_VERIFIED', 'CUSTOMER'] {
  return ['PAYMENT_VERIFIED', 'CUSTOMER'] as const;
}

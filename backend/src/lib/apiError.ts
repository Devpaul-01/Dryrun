/**
 * The one shape every error response takes across the entire API:
 *   { error: "CODE", message: "human text", details?: {...} }
 * Constructed in exactly one place — the terminal error-handling middleware
 * (middleware/errorHandler.ts). Route/service code throws ApiError; it never
 * constructs the response shape itself.
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;
  // FIX (backend-takeover audit, Task #16 — mobile-readiness review): see
  // rateLimited() below for why this exists.
  public readonly retryAfterSeconds?: number;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>, retryAfterSeconds?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  static badRequest(message: string, details?: Record<string, unknown>) {
    return new ApiError(400, 'VALIDATION_ERROR', message, details);
  }
  static unauthorized(message = 'Authentication required.') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'You do not have access to this resource.') {
    return new ApiError(403, 'FORBIDDEN', message);
  }
  static notFound(message = 'Resource not found.') {
    return new ApiError(404, 'NOT_FOUND', message);
  }
  static conflict(message: string, details?: Record<string, unknown>) {
    return new ApiError(409, 'CONFLICT', message, details);
  }
  /**
   * FIX (backend-takeover audit, Task #16 — mobile-readiness review): a
   * 429 was thrown with no `Retry-After` header anywhere in the stack —
   * middleware/rateLimit.ts knows exactly how many seconds remain in the
   * current fixed window (it computes the window boundary to key Redis
   * by) but never passed that through. Without it, a client has no
   * principled way to back off: it either guesses a fixed delay (likely
   * wrong — too short re-triggers the limit, too long wastes time) or
   * retries blindly. A mobile client especially benefits from a correct,
   * standard Retry-After to drive its own retry/backoff logic. Optional
   * so every other 429 call site (e.g. budgetExceeded, which isn't a
   * fixed-window rate limit and has no natural "wait N seconds" answer)
   * is unaffected.
   */
  static rateLimited(message = 'Too many requests. Please slow down.', retryAfterSeconds?: number) {
    return new ApiError(429, 'RATE_LIMIT_EXCEEDED', message, undefined, retryAfterSeconds);
  }
  static featureGate(reason: string, details?: Record<string, unknown>) {
    return new ApiError(402, reason, 'This action requires a plan upgrade.', details);
  }
  static internal(message = 'Something went wrong. Please try again.') {
    return new ApiError(500, 'INTERNAL_ERROR', message);
  }
  static aiUnavailable(message = 'Having trouble responding right now — try sending that again.') {
    return new ApiError(503, 'AI_UNAVAILABLE', message);
  }
  static budgetExceeded(message = 'This workspace has reached its AI usage budget for today.') {
    return new ApiError(429, 'AI_BUDGET_EXCEEDED', message);
  }
}

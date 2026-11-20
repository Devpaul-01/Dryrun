/**
 * Crash/error reporting seam. The app calls `reportError` from its error
 * boundary and global handlers; which service receives it is decided in one
 * place. No vendor SDK is bundled by default — call `setErrorReporter` once at
 * startup (e.g. with Sentry's `captureException`) when a DSN is available.
 * Never pass tokens, message content or other PII in `context`.
 */
export type ErrorReporter = (error: Error, context?: Record<string, string>) => void;

let reporter: ErrorReporter = (error, context) => {
  if (__DEV__) console.error('[error]', error, context ?? '');
};

export function setErrorReporter(next: ErrorReporter) {
  reporter = next;
}

export function reportError(error: unknown, context?: Record<string, string>) {
  const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error');
  try {
    reporter(err, context);
  } catch {
    /* reporting must never throw */
  }
}

/** Installs reporting for uncaught JS errors and unhandled promise rejections. */
export function installGlobalErrorHandlers() {
  const errorUtils = (globalThis as { ErrorUtils?: { getGlobalHandler: () => (e: Error, fatal?: boolean) => void; setGlobalHandler: (h: (e: Error, fatal?: boolean) => void) => void } }).ErrorUtils;
  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((e, fatal) => {
      reportError(e, { source: 'global', fatal: String(!!fatal) });
      previous(e, fatal);
    });
  }
  const g = globalThis as { addEventListener?: (type: string, cb: (e: { reason?: unknown }) => void) => void };
  g.addEventListener?.('unhandledrejection', (e) => reportError(e.reason, { source: 'unhandledrejection' }));
}

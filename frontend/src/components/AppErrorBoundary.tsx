import type { ErrorBoundaryProps } from 'expo-router';
import React from 'react';

import { ErrorFallback } from '@/components/ErrorFallback';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { reportError } from '@/utils/crashReporting';

/** expo-router route error boundary: reports once, then shows the fallback. `retry` re-renders the route. */
export function AppErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  React.useEffect(() => {
    reportError(error, { source: 'route-boundary' });
  }, [error]);
  // The boundary can replace the root layout, so it brings its own theme.
  return (
    <ThemeProvider>
      <ErrorFallback onRetry={() => void retry()} />
    </ThemeProvider>
  );
}

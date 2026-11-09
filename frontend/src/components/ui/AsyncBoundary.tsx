import React from 'react';
import { ScrollView, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { isApiException, isRateLimitException } from '@/types/errors';

import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { Skeleton, type SkeletonVariant } from './Skeleton';
import { Text } from './Text';

export interface AsyncBoundaryProps {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  /** True when the data loaded successfully but is an empty collection. */
  isEmpty?: boolean;
  onRetry?: () => void;
  skeletonVariant?: SkeletonVariant;
  skeletonCount?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  children: React.ReactNode;
}

function messageFor(error: unknown): string {
  if (isRateLimitException(error)) {
    return error.retryAfterSeconds
      ? `Too many requests — try again in ${error.retryAfterSeconds}s.`
      : 'Too many requests — try again shortly.';
  }
  if (isApiException(error)) {
    return error.body?.message ?? 'Something went wrong. Please try again.';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

/**
 * The standard loading/error/empty/success wrapper used throughout the app
 * (architecture doc §4.3) so every screen handles all four states the same
 * way instead of ad-hoc spinners and silent blank screens.
 */
export function AsyncBoundary({
  isLoading,
  isError,
  error,
  isEmpty = false,
  onRetry,
  skeletonVariant = 'row',
  skeletonCount = 3,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyActionLabel,
  onEmptyAction,
  children,
}: AsyncBoundaryProps) {
  const theme = useTheme();

  if (isLoading) {
    return (
      <View style={{ padding: theme.spacing.lg }}>
        <Skeleton variant={skeletonVariant} count={skeletonCount} />
      </View>
    );
  }

  if (isError) {
    return (
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: theme.spacing.xl,
            gap: theme.spacing.md,
          }}
        >
          <Text variant="heading" style={{ textAlign: 'center' }}>
            Couldn&apos;t load this
          </Text>
          <Text variant="caption" color="secondary" style={{ textAlign: 'center' }}>
            {messageFor(error)}
          </Text>
          {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
        </View>
      </ScrollView>
    );
  }

  if (isEmpty) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        actionLabel={emptyActionLabel}
        onAction={onEmptyAction}
      />
    );
  }

  return <>{children}</>;
}

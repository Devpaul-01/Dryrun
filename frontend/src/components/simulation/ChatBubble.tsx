import React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import type { ChatItem } from '@/utils/liveSession';

export interface ChatBubbleProps {
  item: ChatItem;
  /** Persona name shown above buyer bubbles. */
  buyerName?: string;
  onRetry?: (localId: string) => void;
}

/** Buyer bubbles sit left on an elevated surface; the user's sit right in the accent colour. A failed send flips in place to a tap-to-retry state. */
function ChatBubbleImpl({ item, buyerName, onRetry }: ChatBubbleProps) {
  const theme = useTheme();
  const mine = item.role === 'user';
  const failed = item.status === 'failed';

  const bubble = (
    <View
      style={{
        maxWidth: '82%',
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm + 2,
        borderRadius: theme.radius.card,
        borderBottomRightRadius: mine ? 4 : theme.radius.card,
        borderBottomLeftRadius: mine ? theme.radius.card : 4,
        backgroundColor: mine ? theme.colors.accent.primary : theme.colors.bg.elevated,
        borderWidth: failed ? 1 : 0,
        borderColor: theme.colors.signal.negative,
        opacity: item.status === 'sending' ? 0.7 : 1,
      }}
    >
      <Text variant="body" style={{ color: mine ? theme.colors.accent.onPrimary : theme.colors.content.primary }}>
        {item.content}
      </Text>
    </View>
  );

  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: 2 }}>
      {!mine && buyerName ? (
        <Text variant="micro" color="tertiary" style={{ marginLeft: theme.spacing.xs }}>
          {buyerName}
        </Text>
      ) : null}
      {failed ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Message failed to send. Tap to retry" onPress={() => onRetry?.(item.localId)} style={{ alignItems: 'flex-end', width: '100%' }}>
          {bubble}
          <Text variant="micro" color="negative" style={{ marginTop: 2 }}>
            Failed to send — tap to retry
          </Text>
        </Pressable>
      ) : (
        bubble
      )}
    </View>
  );
}

/** Memoised: the reducer keeps unchanged items referentially stable, so a long chat re-renders only the bubble that changed. */
export const ChatBubble = React.memo(ChatBubbleImpl);

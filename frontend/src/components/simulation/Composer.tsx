import React, { useState } from 'react';
import { Platform, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

export const MESSAGE_MAX = 4000;

export interface ComposerProps {
  /** Returns true if the message was accepted (the field then clears). */
  onSend: (content: string) => boolean;
  disabled: boolean;
  /** Shown instead of the input when the session can no longer take messages. */
  disabledReason?: string;
}

/** Safe-area-aware composer; the send button disables the instant it is tapped via `disabled`, before the server round-trip. */
export function Composer({ onSend, disabled, disabledReason }: ComposerProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const trimmed = text.trim();
  const tooLong = trimmed.length > MESSAGE_MAX;

  function submit() {
    if (disabled || !trimmed || tooLong) return;
    if (onSend(trimmed)) setText('');
  }

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: theme.colors.border.subtle,
        backgroundColor: theme.colors.bg.surface,
        paddingHorizontal: theme.layout.screenPaddingPhone,
        paddingTop: theme.spacing.sm,
        paddingBottom: Math.max(insets.bottom, theme.spacing.sm),
        gap: theme.spacing.xs,
      }}
    >
      {disabledReason ? (
        <Text variant="caption" color="secondary" style={{ textAlign: 'center', paddingVertical: theme.spacing.sm }}>
          {disabledReason}
        </Text>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.sm }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Type your reply…"
            placeholderTextColor={theme.colors.content.tertiary}
            multiline
            editable={!disabled}
            accessibilityLabel="Message"
            onKeyPress={(e) => {
              // Web: Enter sends, Shift+Enter inserts a newline.
              const native = e.nativeEvent as unknown as { key: string; shiftKey?: boolean };
              if (Platform.OS === 'web' && native.key === 'Enter' && !native.shiftKey) {
                e.preventDefault?.();
                submit();
              }
            }}
            style={[
              theme.typography.body,
              {
                flex: 1,
                maxHeight: 120,
                color: theme.colors.content.primary,
                backgroundColor: theme.colors.bg.canvas,
                borderWidth: 1,
                borderColor: tooLong ? theme.colors.signal.negative : theme.colors.border.subtle,
                borderRadius: theme.radius.nested,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm + 2,
              },
            ]}
          />
          <Button label="Send" variant="primary" disabled={disabled || !trimmed || tooLong} onPress={submit} />
        </View>
      )}
      {tooLong ? (
        <Text variant="micro" color="negative">
          Messages are limited to {MESSAGE_MAX} characters ({trimmed.length - MESSAGE_MAX} over).
        </Text>
      ) : null}
    </View>
  );
}

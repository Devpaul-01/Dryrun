import React, { useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { Text } from './Text';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string;
  /** Live character counter (shown right-aligned under the field); turns negative when over the limit. */
  counter?: { current: number; max: number };
}

/**
 * Labeled text input (single- or multi-line) with inline error text and an optional live counter (architecture doc §9:
 * inline field validation before submit, mirrored across every auth form).
 */
export function TextField({ label, error, counter, multiline, onFocus, onBlur, ...rest }: TextFieldProps) {
  const theme = useTheme();
  const [isFocused, setIsFocused] = useState(false);

  const borderColor = error
    ? theme.colors.signal.negative
    : isFocused
      ? theme.colors.accent.primary
      : theme.colors.border.subtle;

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text variant="caption" color="secondary">
        {label}
      </Text>
      <TextInput
        placeholderTextColor={theme.colors.content.tertiary}
        style={[
          theme.typography.body,
          {
            color: theme.colors.content.primary,
            backgroundColor: theme.colors.bg.surface,
            borderWidth: 1,
            borderColor,
            borderRadius: theme.radius.nested,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.md,
          },
          multiline ? { minHeight: 112, textAlignVertical: 'top' } : null,
        ]}
        multiline={multiline}
        onFocus={(e) => {
          setIsFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setIsFocused(false);
          onBlur?.(e);
        }}
        {...rest}
      />
      {error || counter ? (
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md }}
        >
          <View style={{ flex: 1 }}>
            {error ? (
              <Text variant="caption" color="negative">
                {error}
              </Text>
            ) : null}
          </View>
          {counter ? (
            <Text variant="caption" color={counter.current > counter.max ? 'negative' : 'tertiary'}>
              {counter.current}/{counter.max}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

import React, { useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { Text } from './Text';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string;
}

/**
 * Single-line labeled input with inline error text (architecture doc §9:
 * inline field validation before submit, mirrored across every auth form).
 */
export function TextField({ label, error, onFocus, onBlur, ...rest }: TextFieldProps) {
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
        ]}
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
      {error ? (
        <Text variant="caption" color="negative">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

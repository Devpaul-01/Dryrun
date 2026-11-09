import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  View,
} from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

/** Primary/secondary/ghost/destructive variants, loading state built in (architecture doc §9.4). */
export function Button({
  label,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  fullWidth = false,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  const palette = (() => {
    switch (variant) {
      case 'primary':
        return {
          bg: theme.colors.accent.primary,
          text: theme.colors.accent.onPrimary,
          border: 'transparent',
        };
      case 'secondary':
        return {
          bg: theme.colors.bg.elevated,
          text: theme.colors.content.primary,
          border: theme.colors.border.strong,
        };
      case 'ghost':
        return {
          bg: 'transparent',
          text: theme.colors.content.primary,
          border: 'transparent',
        };
      case 'destructive':
        return {
          bg: theme.colors.signal.negative,
          text: theme.colors.content.inverse,
          border: 'transparent',
        };
    }
  })();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          borderWidth: variant === 'secondary' ? 1 : 0,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
          borderRadius: theme.radius.nested,
          gap: theme.spacing.sm,
        },
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={palette.text} size="small" />
      ) : (
        <>
          {icon ? <View>{icon}</View> : null}
          <Text variant="bodyStrong" style={{ color: palette.text }}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import React from 'react';
import { Pressable, View, type ViewProps } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { Text } from './Text';

export interface ChipProps extends ViewProps {
  label: string;
  /** Static chips render as plain View; selectable chips take onPress + selected. */
  selectable?: boolean;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
}

/** Selectable + static variants — scenario/pressure/goal pickers, axis labels (architecture doc §9.4). */
export function Chip({
  label,
  selectable = false,
  selected = false,
  onPress,
  disabled = false,
  style,
  ...rest
}: ChipProps) {
  const theme = useTheme();

  const content = (pressed?: boolean) => (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          borderRadius: theme.radius.pill,
          backgroundColor: selected ? theme.colors.accent.primary : theme.colors.bg.elevated,
          borderWidth: 1,
          borderColor: selected ? theme.colors.accent.primary : theme.colors.border.subtle,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
      {...rest}
    >
      <Text
        variant="micro"
        style={{ color: selected ? theme.colors.accent.onPrimary : theme.colors.content.secondary }}
      >
        {label}
      </Text>
    </View>
  );

  if (!selectable) {
    return content();
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
    >
      {({ pressed }) => content(pressed)}
    </Pressable>
  );
}

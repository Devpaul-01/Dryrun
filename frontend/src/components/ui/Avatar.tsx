import React from 'react';
import { Image, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { Text } from './Text';

export interface AvatarProps {
  name: string;
  imageUrl?: string | null;
  size?: number;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export function Avatar({ name, imageUrl, size = 36 }: AvatarProps) {
  const theme = useTheme();

  if (imageUrl) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        accessibilityLabel={name}
      />
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.colors.bg.elevated,
        borderWidth: 1,
        borderColor: theme.colors.border.subtle,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      accessibilityLabel={name}
    >
      <Text variant="caption" color="secondary">
        {initialsFor(name)}
      </Text>
    </View>
  );
}

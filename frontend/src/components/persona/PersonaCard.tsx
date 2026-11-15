import React, { useEffect, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';

import { Badge, Card, Skeleton, Text } from '@/components/ui';
import { GENERATING_NAME } from '@/hooks/usePersonas';
import { useTheme } from '@/theme/ThemeProvider';
import type { PersonaListItem } from '@/types/api';
import { personaSourceLabel } from '@/utils/labels';

export interface PersonaCardProps {
  persona: Pick<PersonaListItem, 'id' | 'name' | 'role' | 'source_type'>;
  onPress?: () => void;
}

/**
 * Library row. The list endpoint carries no generation_status, so the
 * backend's 'Generating…' placeholder name is the only signal available
 * here; the detail screen resolves the real status (ready / failed).
 */
export function PersonaCard({ persona, onPress }: PersonaCardProps) {
  const theme = useTheme();
  const generating = persona.name === GENERATING_NAME;

  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {generating ? (
        <PersonaGeneratingCard source={personaSourceLabel(persona.source_type)} />
      ) : (
        <Card style={{ gap: theme.spacing.xs }}>
          <Text variant="heading">{persona.name}</Text>
          <Text variant="body" color="secondary">
            {persona.role}
          </Text>
          <View style={{ flexDirection: 'row', marginTop: theme.spacing.xs }}>
            <Badge label={personaSourceLabel(persona.source_type)} />
          </View>
        </Card>
      )}
    </Pressable>
  );
}

/** Pulsing placeholder shown while a from-source persona is being synthesised (§7.6). */
export function PersonaGeneratingCard({ source }: { source: string }) {
  const theme = useTheme();
  const [pulse] = useState(() => new Animated.Value(0.6));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.6, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View style={{ opacity: pulse }}>
      <Card style={{ gap: theme.spacing.sm, borderColor: theme.colors.accent.primary }}>
        <Text variant="heading">Building your buyer…</Text>
        <Skeleton variant="text" width="60%" />
        <View style={{ flexDirection: 'row' }}>
          <Badge label={`${source} · generating`} tone="accent" />
        </View>
      </Card>
    </Animated.View>
  );
}

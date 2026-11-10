import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AsyncBoundary,
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Skeleton,
  Text,
} from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Dev-only visual QA screen for every UI primitive and the full color
 * palette — not part of the (public)/(app) route trees, reached directly
 * at /_gallery during development. Each milestone's new primitives get
 * added here as they're built, so design review never requires wiring a
 * real screen first.
 */
export default function Gallery() {
  const theme = useTheme();
  const [selectedChip, setSelectedChip] = useState('scenario-skeptic');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.xl }}>
        <Text variant="display">Component gallery</Text>

        <Section title="Typography">
          <Text variant="display">Display · Aa</Text>
          <Text variant="title">Title · Aa</Text>
          <Text variant="heading">Heading · Aa</Text>
          <Text variant="body">Body · The quick brown fox jumps.</Text>
          <Text variant="bodyStrong">Body strong · The quick brown fox jumps.</Text>
          <Text variant="caption" color="secondary">
            Caption secondary · The quick brown fox jumps.
          </Text>
          <Text variant="micro" color="tertiary">
            Micro tertiary label
          </Text>
        </Section>

        <Section title="Colors">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {Object.entries(theme.colors).flatMap(([group, shades]) =>
              Object.entries(shades as Record<string, string>).map(([name, hex]) => (
                <Swatch key={`${group}.${name}`} label={`${group}.${name}`} hex={hex} />
              )),
            )}
          </View>
        </Section>

        <Section title="Buttons">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            <Button label="Primary" variant="primary" onPress={() => {}} />
            <Button label="Secondary" variant="secondary" onPress={() => {}} />
            <Button label="Ghost" variant="ghost" onPress={() => {}} />
            <Button label="Destructive" variant="destructive" onPress={() => {}} />
            <Button label="Loading" variant="primary" loading onPress={() => {}} />
            <Button label="Disabled" variant="primary" disabled onPress={() => {}} />
          </View>
        </Section>

        <Section title="Chips">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            <Chip label="Static chip" />
            <Chip
              label="Skeptic"
              selectable
              selected={selectedChip === 'scenario-skeptic'}
              onPress={() => setSelectedChip('scenario-skeptic')}
            />
            <Chip
              label="Price pushback"
              selectable
              selected={selectedChip === 'scenario-price'}
              onPress={() => setSelectedChip('scenario-price')}
            />
            <Chip label="Disabled" selectable disabled />
          </View>
        </Section>

        <Section title="Badges">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            <Badge label="Neutral" tone="neutral" />
            <Badge label="Positive" tone="positive" />
            <Badge label="Warning" tone="warning" />
            <Badge label="Negative" tone="negative" />
            <Badge label="Accent" tone="accent" />
          </View>
        </Section>

        <Section title="Avatars">
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
            <Avatar name="Seyi Ogunsola" size={28} />
            <Avatar name="Seyi Ogunsola" size={36} />
            <Avatar name="Seyi Ogunsola" size={48} />
            <Avatar name="Single" size={36} />
          </View>
        </Section>

        <Section title="Card">
          <Card>
            <Text variant="heading">Card title</Text>
            <Text variant="caption" color="secondary" style={{ marginTop: 4 }}>
              A standard surface card with the default radius.
            </Text>
            <View style={{ marginTop: theme.spacing.md }}>
              <Card nested padded>
                <Text variant="caption">Nested card (smaller radius)</Text>
              </Card>
            </View>
          </Card>
        </Section>

        <Section title="Skeleton">
          <Skeleton variant="text" count={3} />
          <View style={{ height: theme.spacing.md }} />
          <Skeleton variant="row" count={2} />
          <View style={{ height: theme.spacing.md }} />
          <Skeleton variant="card" />
        </Section>

        <Section title="EmptyState">
          <Card padded={false}>
            <EmptyState
              title="No sessions yet"
              description="Start your first practice session to see it here."
              actionLabel="Start practicing"
              onAction={() => {}}
            />
          </Card>
        </Section>

        <Section title="AsyncBoundary — loading">
          <Card padded={false}>
            <AsyncBoundary isLoading isError={false}>
              <Text>unreachable</Text>
            </AsyncBoundary>
          </Card>
        </Section>

        <Section title="AsyncBoundary — error">
          <Card padded={false}>
            <AsyncBoundary
              isLoading={false}
              isError
              error={new Error('Could not reach the server.')}
              onRetry={() => {}}
            >
              <Text>unreachable</Text>
            </AsyncBoundary>
          </Card>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="heading">{title}</Text>
      {children}
    </View>
  );
}

function Swatch({ label, hex }: { label: string; hex: string }) {
  const theme = useTheme();
  return (
    <View style={{ width: 96, gap: 4 }}>
      <View
        style={{
          height: 40,
          borderRadius: theme.radius.nested,
          backgroundColor: hex,
          borderWidth: 1,
          borderColor: theme.colors.border.subtle,
        }}
      />
      <Text variant="micro" color="tertiary">
        {label}
      </Text>
    </View>
  );
}

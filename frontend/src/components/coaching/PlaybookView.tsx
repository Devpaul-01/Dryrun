import * as Clipboard from 'expo-clipboard';
import React, { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import type { PlaybookVersion } from '@/types/api';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      label={copied ? 'Copied' : 'Copy'}
      variant="ghost"
      accessibilityLabel={`Copy ${label}`}
      onPress={async () => {
        await Clipboard.setStringAsync(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    />
  );
}

function Section({ title, copyText, children }: { title: string; copyText: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Card style={{ gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="caption" color="secondary">
          {title}
        </Text>
        <CopyButton text={copyText} label={title} />
      </View>
      {children}
    </Card>
  );
}

/** Normalises the two shapes objection_responses can take (structured pairs, or plain strings). */
export function objectionPairs(value: PlaybookVersion['objection_responses']): { objection: string | null; response: string }[] {
  return (value as (string | { objection: string; response: string })[]).map((o) =>
    typeof o === 'string' ? { objection: null, response: o } : { objection: o.objection, response: o.response },
  );
}

/** Read-only playbook body, shared by the owner's detail screen and the public share view. */
export function PlaybookView({ version }: { version: PlaybookVersion }) {
  const theme = useTheme();
  const objections = objectionPairs(version.objection_responses);
  return (
    <View style={{ gap: theme.spacing.md }}>
      <Section title="Key insight" copyText={version.key_insight}>
        <Text variant="body">{version.key_insight}</Text>
      </Section>
      <Section title="Opening message" copyText={version.opening_message}>
        <Text variant="body">{version.opening_message}</Text>
      </Section>
      <Section title="Discovery questions" copyText={version.discovery_questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}>
        {version.discovery_questions.map((q, i) => (
          <Text key={i} variant="body">
            {i + 1}. {q}
          </Text>
        ))}
      </Section>
      <Section
        title="Objection responses"
        copyText={objections.map((o) => (o.objection ? `${o.objection}\n${o.response}` : o.response)).join('\n\n')}
      >
        {objections.map((o, i) => (
          <View key={i} style={{ gap: 2 }}>
            {o.objection ? (
              <Text variant="caption" color="secondary">
                “{o.objection}”
              </Text>
            ) : null}
            <Text variant="body">{o.response}</Text>
          </View>
        ))}
      </Section>
      <Section title="Closing call to action" copyText={version.closing_cta}>
        <Text variant="body">{version.closing_cta}</Text>
      </Section>
    </View>
  );
}

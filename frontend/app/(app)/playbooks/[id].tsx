import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Platform, ScrollView, Share, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlaybookView } from '@/components/coaching/PlaybookView';
import { AsyncBoundary, Badge, Button, Card, Text } from '@/components/ui';
import {
  usePlaybook,
  usePlaybookVersions,
  useRegeneratePlaybook,
  useRevokePlaybookShare,
  useSharePlaybook,
} from '@/hooks/usePlaybooks';
import { env } from '@/config/env';
import { useTheme } from '@/theme/ThemeProvider';
import { isApiException } from '@/types/errors';
import { buildPlaybookShareUrl } from '@/utils/shareLink';

function ShareCard({ playbookId, token, attribution }: { playbookId: string; token: string | null; attribution: boolean }) {
  const theme = useTheme();
  const share = useSharePlaybook(playbookId);
  const revoke = useRevokePlaybookShare(playbookId);
  const [attributionOn, setAttributionOn] = useState(token ? attribution : true);
  const [copied, setCopied] = useState(false);
  const url = token ? buildPlaybookShareUrl(token, env.shareBaseUrl) : null;

  return (
    <Card style={{ gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="heading">Sharing</Text>
        <Badge label={token ? 'Shared' : 'Private'} tone={token ? 'accent' : 'neutral'} />
      </View>

      {!token ? (
        <>
          <Text variant="body" color="secondary">
            Anyone with the link can read this playbook. You can turn sharing off at any time.
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="body">Show that it came from DryRun</Text>
            <Switch value={attributionOn} onValueChange={setAttributionOn} accessibilityLabel="Show attribution" />
          </View>
          <Button label="Create share link" variant="primary" loading={share.isPending} onPress={() => share.mutate(attributionOn)} />
        </>
      ) : (
        <>
          <Text variant="caption" color="secondary" selectable>
            {url}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            <Button
              label={copied ? 'Copied' : 'Copy link'}
              variant="secondary"
              onPress={async () => {
                if (!url) return;
                await Clipboard.setStringAsync(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            />
            {Platform.OS !== 'web' && url ? <Button label="Share…" variant="secondary" onPress={() => void Share.share({ message: url })} /> : null}
            <Button label="Stop sharing" variant="destructive" loading={revoke.isPending} onPress={() => revoke.mutate()} />
          </View>
        </>
      )}
      {share.isError || revoke.isError ? (
        <Text variant="caption" color="negative">
          Couldn&apos;t update sharing. Please try again.
        </Text>
      ) : null}
    </Card>
  );
}

/** Playbook detail (architecture doc §7.13): content, sharing, regenerate, and version history. */
export default function PlaybookDetail() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const playbook = usePlaybook(id);
  const regenerate = useRegeneratePlaybook(id);
  const [showVersions, setShowVersions] = useState(false);
  const versions = usePlaybookVersions(id, showVersions);
  const [viewing, setViewing] = useState<number | null>(null);

  const data = playbook.data;
  const shownVersion = viewing !== null ? versions.data?.find((v) => v.version_number === viewing) : undefined;
  const regenError = regenerate.isError
    ? isApiException(regenerate.error)
      ? (regenerate.error.body?.message ?? 'Could not regenerate.')
      : 'Could not regenerate. Please try again.'
    : undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <ScrollView contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="title" numberOfLines={2} style={{ flex: 1 }}>
            {data?.title ?? 'Playbook'}
          </Text>
          <Button label="Back" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)/playbooks'))} />
        </View>

        <AsyncBoundary isLoading={playbook.isPending} isError={playbook.isError} error={playbook.error} onRetry={() => void playbook.refetch()} skeletonVariant="card">
          {data ? (
            <View style={{ gap: theme.spacing.lg }}>
              {shownVersion ? (
                <Card style={{ gap: theme.spacing.xs, borderColor: theme.colors.signal.warning }}>
                  <Text variant="caption" color="warning">
                    Viewing version {shownVersion.version_number} (older)
                  </Text>
                  <Button label="Back to current" variant="secondary" onPress={() => setViewing(null)} />
                </Card>
              ) : null}
              <PlaybookView version={shownVersion ?? data.current_version} />

              <ShareCard playbookId={data.id} token={data.share_token} attribution={data.share_attribution_enabled} />

              <View style={{ gap: theme.spacing.sm }}>
                {regenError ? (
                  <Text variant="caption" color="negative">
                    {regenError}
                  </Text>
                ) : null}
                <Button
                  label="Regenerate from latest data"
                  variant="secondary"
                  fullWidth
                  loading={regenerate.isPending}
                  onPress={() => regenerate.mutate(undefined, { onSuccess: () => setViewing(null) })}
                />
                <Button label={showVersions ? 'Hide version history' : 'Version history'} variant="ghost" fullWidth onPress={() => setShowVersions((s) => !s)} />
                {showVersions ? (
                  versions.isPending ? (
                    <Text variant="caption" color="secondary">
                      Loading versions…
                    </Text>
                  ) : (
                    <View style={{ gap: theme.spacing.xs }}>
                      {(versions.data ?? []).map((v) => (
                        <Button
                          key={v.version_number}
                          label={`Version ${v.version_number} · ${new Date(v.created_at).toLocaleDateString()}${v.version_number === data.current_version.version_number ? ' (current)' : ''}`}
                          variant={viewing === v.version_number ? 'primary' : 'secondary'}
                          onPress={() => setViewing(v.version_number === data.current_version.version_number ? null : v.version_number)}
                        />
                      ))}
                    </View>
                  )
                ) : null}
              </View>
            </View>
          ) : null}
        </AsyncBoundary>
      </ScrollView>
    </SafeAreaView>
  );
}

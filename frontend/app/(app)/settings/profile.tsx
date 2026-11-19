import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar, Button, Card, Text, TextField } from '@/components/ui';
import { useUpdateProfile } from '@/hooks/useAccount';
import { useMe } from '@/hooks/useAuth';
import { useTheme } from '@/theme/ThemeProvider';

/** Profile: display name is the only editable field the backend accepts (PATCH /user/me). */
export default function Profile() {
  const theme = useTheme();
  const router = useRouter();
  const me = useMe();
  const update = useUpdateProfile();
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (me.data?.display_name != null) setName(me.data.display_name); }, [me.data?.display_name]);

  const trimmed = name.trim();
  const error = trimmed.length === 0 ? 'Enter your name.' : trimmed.length > 120 ? 'Keep it under 120 characters.' : undefined;
  const dirty = trimmed !== (me.data?.display_name ?? '');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <ScrollView contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.xl }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="title">Profile</Text>
          <Button label="Back" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)/settings/account'))} />
        </View>
        <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <Avatar name={me.data?.display_name || me.data?.email || '?'} size={72} />
          <Text variant="caption" color="tertiary">
            {me.data?.email}
          </Text>
        </View>
        <Card style={{ gap: theme.spacing.sm }}>
          <TextField label="Display name" value={name} onChangeText={(t) => { setName(t); setSaved(false); }} autoCapitalize="words" error={dirty ? error : undefined} />
          {update.isError ? (
            <Text variant="caption" color="negative">
              Couldn&apos;t save. Please try again.
            </Text>
          ) : null}
          {saved ? (
            <Text variant="caption" color="positive">
              Saved.
            </Text>
          ) : null}
          <Button label="Save" variant="primary" disabled={!dirty || !!error} loading={update.isPending} onPress={() => update.mutate(trimmed, { onSuccess: () => setSaved(true) })} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

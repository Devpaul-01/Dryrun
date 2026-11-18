import { useRouter } from 'expo-router';
import React from 'react';
import { Modal, Pressable, View } from 'react-native';

import { Button, Text } from '@/components/ui';
import { useUpgradeStore } from '@/stores/upgradeStore';
import { useTheme } from '@/theme/ThemeProvider';
import { upgradeCopy } from '@/utils/upgradeCopy';

/** One consistent upgrade prompt for every 402 (architecture doc §2.8). Mounted once in the root layout. */
export function UpgradeSheet() {
  const theme = useTheme();
  const router = useRouter();
  const gate = useUpgradeStore((s) => s.gate);
  const dismiss = useUpgradeStore((s) => s.dismiss);
  const copy = gate ? upgradeCopy(gate) : null;

  return (
    <Modal visible={!!gate} transparent animationType="slide" onRequestClose={dismiss}>
      <Pressable accessibilityLabel="Close" onPress={dismiss} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityViewIsModal
          onPress={() => undefined}
          style={{
            backgroundColor: theme.colors.bg.elevated,
            padding: theme.layout.screenPaddingPhone,
            paddingBottom: theme.spacing.xl,
            gap: theme.spacing.md,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            width: '100%',
            maxWidth: 560,
            alignSelf: 'center',
          }}
        >
          <Text variant="title">{copy?.title}</Text>
          <Text variant="body" color="secondary">
            {copy?.body}
          </Text>
          <View style={{ gap: theme.spacing.sm }}>
            <Button
              label="See plans"
              variant="primary"
              fullWidth
              onPress={() => {
                dismiss();
                router.push('/(app)/billing/plans');
              }}
            />
            <Button label="Not now" variant="ghost" fullWidth onPress={dismiss} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

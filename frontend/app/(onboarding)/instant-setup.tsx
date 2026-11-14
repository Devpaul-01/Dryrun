import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Chip, Text, TextField } from '@/components/ui';
import { useInstantSetup } from '@/hooks/useOnboarding';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useTheme } from '@/theme/ThemeProvider';
import { isApiException } from '@/types/errors';
import {
  AUDIENCE_MAX,
  PRODUCT_MAX,
  TONE_MAX,
  validateAudience,
  validateProduct,
  validateTone,
} from '@/utils/onboardingValidation';

const TONE_PRESETS = ['Direct', 'Friendly', 'Consultative', 'Skeptical', 'Formal', 'Casual'];

/**
 * Instant Setup (architecture doc §7.2). One screen, three fields. On success
 * the mutation writes completed:true into the onboarding cache, the gate flips,
 * and the user lands on the dashboard with no confirmation step.
 */
export default function InstantSetup() {
  const theme = useTheme();
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId) ?? '';
  const setup = useInstantSetup(workspaceId);

  const [product, setProduct] = useState('');
  const [audience, setAudience] = useState('');
  const [tone, setTone] = useState('');
  const [touched, setTouched] = useState(false);

  const productError = touched ? validateProduct(product) : undefined;
  const audienceError = touched ? validateAudience(audience) : undefined;
  const toneError = validateTone(tone);

  const errorMessage = setup.isError
    ? isApiException(setup.error)
      ? (setup.error.body?.message ?? 'Could not save your setup. Please try again.')
      : 'Something went wrong. Please try again.'
    : undefined;

  function togglePreset(preset: string) {
    setTone((current) => (current.trim().toLowerCase() === preset.toLowerCase() ? '' : preset));
  }

  function handleSubmit() {
    setTouched(true);
    if (validateProduct(product) || validateAudience(audience) || validateTone(tone)) return;
    const tonePreference = tone.trim();
    setup.mutate({
      product_description: product.trim(),
      target_audience: audience.trim(),
      ...(tonePreference ? { tone_preference: tonePreference } : {}),
    });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            padding: theme.layout.screenPaddingPhone,
            gap: theme.spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="title">Set up your practice</Text>
            <Text variant="body" color="secondary">
              Tell us what you sell and who you sell to, so buyers in your simulations feel real.
            </Text>
          </View>

          {errorMessage ? (
            <Card
              style={{
                backgroundColor: theme.colors.bg.elevated,
                borderColor: theme.colors.signal.negative,
              }}
            >
              <Text variant="caption" color="negative">
                {errorMessage}
              </Text>
            </Card>
          ) : null}

          <TextField
            label="What do you sell?"
            placeholder="e.g. Scheduling software for independent clinics"
            value={product}
            onChangeText={setProduct}
            multiline
            counter={{ current: product.trim().length, max: PRODUCT_MAX }}
            error={productError}
            editable={!setup.isPending}
          />
          <TextField
            label="Who do you sell to?"
            placeholder="e.g. Clinic owners and practice managers"
            value={audience}
            onChangeText={setAudience}
            multiline
            counter={{ current: audience.trim().length, max: AUDIENCE_MAX }}
            error={audienceError}
            editable={!setup.isPending}
          />

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="caption" color="secondary">
              Buyer tone (optional)
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {TONE_PRESETS.map((preset) => (
                <Chip
                  key={preset}
                  label={preset}
                  selectable
                  selected={tone.trim().toLowerCase() === preset.toLowerCase()}
                  disabled={setup.isPending}
                  onPress={() => togglePreset(preset)}
                />
              ))}
            </View>
            <TextField
              label="Or describe it"
              placeholder="e.g. Busy and a little impatient"
              value={tone}
              onChangeText={setTone}
              counter={{ current: tone.trim().length, max: TONE_MAX }}
              error={toneError}
              editable={!setup.isPending}
            />
          </View>

          <Button
            label="Get started"
            variant="primary"
            fullWidth
            loading={setup.isPending}
            onPress={handleSubmit}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PersonaGeneratingCard } from '@/components/persona/PersonaCard';
import { AsyncBoundary, Badge, Button, Card, Text, TextField } from '@/components/ui';
import { GENERATING_NAME, useDeletePersona, usePersona, useUpdatePersona } from '@/hooks/usePersonas';
import { useTheme } from '@/theme/ThemeProvider';
import type { Persona } from '@/types/api';
import { personaSourceLabel } from '@/utils/labels';
import { personaErrorMessage } from '@/utils/personaErrors';
import { PERSONA_LIMITS, validateManualPersona } from '@/utils/personaValidation';

function confirmDelete(onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm('Delete this buyer?')) onConfirm();
    return;
  }
  Alert.alert('Delete this buyer?', 'Past sessions that used it are not affected.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onConfirm },
  ]);
}

function PersonaEditor({ persona }: { persona: Persona }) {
  const theme = useTheme();
  const router = useRouter();
  const update = useUpdatePersona(persona.id);
  const remove = useDeletePersona();

  const [name, setName] = useState(persona.name === GENERATING_NAME ? '' : persona.name);
  const [role, setRole] = useState(persona.role === GENERATING_NAME ? '' : persona.role);
  const [mainPain, setMainPain] = useState(persona.main_pain);
  const [skepticism, setSkepticism] = useState(persona.skepticism_about);
  const [style, setStyle] = useState(persona.communication_style);
  const [touched, setTouched] = useState(false);

  // company_context is create-only on the backend (PATCH ignores it), so it is shown read-only.
  const errors = touched
    ? validateManualPersona({ name, role, companyContext: '', mainPain, skepticism, style })
    : {};
  const dirty =
    name.trim() !== persona.name ||
    role.trim() !== persona.role ||
    mainPain.trim() !== persona.main_pain ||
    skepticism.trim() !== persona.skepticism_about ||
    style.trim() !== persona.communication_style;

  const failure = update.error ?? remove.error;

  function save() {
    setTouched(true);
    if (Object.keys(validateManualPersona({ name, role, companyContext: '', mainPain, skepticism, style })).length) return;
    update.mutate({
      name: name.trim(),
      role: role.trim(),
      main_pain: mainPain.trim(),
      skepticism_about: skepticism.trim(),
      communication_style: style.trim(),
    });
  }

  return (
    <View style={{ gap: theme.spacing.md }}>
      <View style={{ flexDirection: 'row' }}>
        <Badge label={personaSourceLabel(persona.source_type)} />
      </View>

      {persona.generation_status === 'failed' ? (
        <Card style={{ backgroundColor: theme.colors.bg.elevated, borderColor: theme.colors.signal.warning }}>
          <Text variant="caption" color="warning">
            We couldn&apos;t build this buyer from your source. Fill in the details below to finish it yourself, or delete it and try another source.
          </Text>
        </Card>
      ) : null}

      {failure ? (
        <Card style={{ backgroundColor: theme.colors.bg.elevated, borderColor: theme.colors.signal.negative }}>
          <Text variant="caption" color="negative">
            {personaErrorMessage(failure)}
          </Text>
        </Card>
      ) : null}
      {update.isSuccess && !dirty ? (
        <Text variant="caption" color="positive">
          Saved
        </Text>
      ) : null}

      <TextField label="Name" value={name} onChangeText={setName} error={errors.name} />
      <TextField label="Role" value={role} onChangeText={setRole} error={errors.role} />
      {persona.company_context ? (
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="caption" color="secondary">
            Company context
          </Text>
          <Text variant="body">{persona.company_context}</Text>
        </View>
      ) : null}
      <TextField
        label="Main pain"
        value={mainPain}
        onChangeText={setMainPain}
        multiline
        counter={{ current: mainPain.trim().length, max: PERSONA_LIMITS.mainPain }}
        error={errors.mainPain}
      />
      <TextField
        label="What they are skeptical about"
        value={skepticism}
        onChangeText={setSkepticism}
        multiline
        counter={{ current: skepticism.trim().length, max: PERSONA_LIMITS.skepticism }}
        error={errors.skepticism}
      />
      <TextField
        label="Communication style"
        value={style}
        onChangeText={setStyle}
        counter={{ current: style.trim().length, max: PERSONA_LIMITS.style }}
        error={errors.style}
      />

      <Button
        label="Save changes"
        variant="primary"
        fullWidth
        loading={update.isPending}
        disabled={!dirty && persona.generation_status === 'ready'}
        onPress={save}
      />
      <Button
        label="Delete buyer"
        variant="destructive"
        fullWidth
        loading={remove.isPending}
        onPress={() => confirmDelete(() => remove.mutate(persona.id, { onSuccess: () => router.replace('/(app)/persona') }))}
      />
    </View>
  );
}

/** Persona detail / edit (architecture doc §7.6), including the live generating state. */
export default function PersonaDetail() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const persona = usePersona(id);
  const data = persona.data;

  // Remount the editor when the persona finishes generating so its fields seed from the finished data.
  const editorKey = `${data?.id}:${data?.generation_status}`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.lg, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="title">Buyer</Text>
            <Button label="Back" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)/persona'))} />
          </View>
          <AsyncBoundary
            isLoading={persona.isPending}
            isError={persona.isError}
            error={persona.error}
            onRetry={() => void persona.refetch()}
            skeletonVariant="card"
          >
            {data?.generation_status === 'generating' ? (
              <View style={{ gap: theme.spacing.md }}>
                <PersonaGeneratingCard source={personaSourceLabel(data.source_type)} />
                <Text variant="caption" color="secondary">
                  This usually takes under a minute. This page updates on its own — you can leave and come back.
                </Text>
              </View>
            ) : data ? (
              <PersonaEditor key={editorKey} persona={data} />
            ) : null}
          </AsyncBoundary>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

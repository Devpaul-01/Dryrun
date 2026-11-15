import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Chip, Text, TextField } from '@/components/ui';
import {
  type PickedFile,
  useCreatePersona,
  useCreatePersonaFromSource,
  useScenarioCatalog,
  useUploadPersonaSource,
} from '@/hooks/usePersonas';
import { useTheme } from '@/theme/ThemeProvider';
import type { PersonaSourceKind, ScenarioType } from '@/types/api';
import { personaErrorMessage } from '@/utils/personaErrors';
import { PERSONA_LIMITS, validateManualPersona, validateSource } from '@/utils/personaValidation';

type Mode = 'manual' | PersonaSourceKind;

const MODES: { key: Mode; label: string }[] = [
  { key: 'manual', label: 'Describe' },
  { key: 'pasted_text', label: 'Paste text' },
  { key: 'url', label: 'From a URL' },
  { key: 'upload', label: 'Upload' },
];

const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/png',
  'image/jpeg',
];
const MAX_BYTES = 10 * 1024 * 1024;

/** Persona creation (architecture doc §7.6): manual, or from pasted text / URL / uploaded document. */
export default function NewPersona() {
  const theme = useTheme();
  const router = useRouter();
  const catalog = useScenarioCatalog();
  const createManual = useCreatePersona();
  const createFromSource = useCreatePersonaFromSource();
  const upload = useUploadPersonaSource();

  const [mode, setMode] = useState<Mode>('manual');
  const [touched, setTouched] = useState(false);

  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [companyContext, setCompanyContext] = useState('');
  const [mainPain, setMainPain] = useState('');
  const [skepticism, setSkepticism] = useState('');
  const [style, setStyle] = useState('');

  const [scenario, setScenario] = useState<ScenarioType>('cold_open');
  const [pastedText, setPastedText] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<PickedFile | null>(null);
  const [fileError, setFileError] = useState<string | undefined>();

  const busy = createManual.isPending || createFromSource.isPending || upload.isPending;
  const activeError = createManual.error ?? createFromSource.error ?? upload.error;
  const errorMessage = activeError ? personaErrorMessage(activeError) : undefined;

  const manualErrors = touched && mode === 'manual'
    ? validateManualPersona({ name, role, companyContext, mainPain, skepticism, style })
    : {};
  const sourceError =
    touched && mode !== 'manual'
      ? validateSource(mode, { pastedText, url, uploadReady: !!file })
      : undefined;

  function selectMode(next: Mode) {
    if (busy) return;
    createManual.reset();
    createFromSource.reset();
    upload.reset();
    setTouched(false);
    setMode(next);
  }

  async function pickFile() {
    setFileError(undefined);
    const result = await DocumentPicker.getDocumentAsync({ type: ALLOWED_TYPES, copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? '';
    if (!ALLOWED_TYPES.includes(mimeType)) {
      setFile(null);
      setFileError('Unsupported file type. Use PDF, DOCX, TXT, PNG or JPG.');
      return;
    }
    if ((asset.size ?? 0) > MAX_BYTES) {
      setFile(null);
      setFileError('That file is larger than 10MB.');
      return;
    }
    setFile({ uri: asset.uri, name: asset.name, mimeType, size: asset.size ?? 0 });
  }

  function openPersona(id: string) {
    router.replace(`/(app)/persona/${id}`);
  }

  function handleSubmit() {
    setTouched(true);
    if (mode === 'manual') {
      if (Object.keys(validateManualPersona({ name, role, companyContext, mainPain, skepticism, style })).length) return;
      createManual.mutate(
        {
          name: name.trim(),
          role: role.trim(),
          main_pain: mainPain.trim(),
          skepticism_about: skepticism.trim(),
          ...(companyContext.trim() ? { company_context: companyContext.trim() } : {}),
          ...(style.trim() ? { communication_style: style.trim() } : {}),
        },
        { onSuccess: (p) => openPersona(p.id) },
      );
      return;
    }

    if (validateSource(mode, { pastedText, url, uploadReady: !!file })) return;
    const finish = (body: Parameters<typeof createFromSource.mutate>[0]) =>
      createFromSource.mutate(body, { onSuccess: (p) => openPersona(p.id) });

    if (mode === 'pasted_text') {
      finish({ scenario_type: scenario, source_kind: 'pasted_text', pasted_text: pastedText.trim() });
    } else if (mode === 'url') {
      finish({ scenario_type: scenario, source_kind: 'url', url: url.trim() });
    } else if (file) {
      upload.mutate(file, {
        onSuccess: (uploadId) =>
          finish({ scenario_type: scenario, source_kind: 'upload', upload_id: uploadId }),
      });
    }
  }

  const scenarioOptions = catalog.data?.scenario_types ?? [];
  const stylePresets = catalog.data?.communication_style_presets ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="title">New buyer</Text>
            <Button label="Cancel" variant="ghost" onPress={() => router.back()} disabled={busy} />
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {MODES.map((m) => (
              <Chip key={m.key} label={m.label} selectable selected={mode === m.key} onPress={() => selectMode(m.key)} />
            ))}
          </View>

          {errorMessage ? (
            <Card style={{ backgroundColor: theme.colors.bg.elevated, borderColor: theme.colors.signal.negative }}>
              <Text variant="caption" color="negative">
                {errorMessage}
              </Text>
            </Card>
          ) : null}

          {mode === 'manual' ? (
            <View style={{ gap: theme.spacing.md }}>
              <TextField label="Name" value={name} onChangeText={setName} error={manualErrors.name} editable={!busy} />
              <TextField label="Role" value={role} onChangeText={setRole} placeholder="e.g. VP of Operations" error={manualErrors.role} editable={!busy} />
              <TextField
                label="Company context (optional)"
                value={companyContext}
                onChangeText={setCompanyContext}
                multiline
                counter={{ current: companyContext.trim().length, max: PERSONA_LIMITS.companyContext }}
                error={manualErrors.companyContext}
                editable={!busy}
              />
              <TextField
                label="Main pain"
                value={mainPain}
                onChangeText={setMainPain}
                multiline
                counter={{ current: mainPain.trim().length, max: PERSONA_LIMITS.mainPain }}
                error={manualErrors.mainPain}
                editable={!busy}
              />
              <TextField
                label="What they are skeptical about"
                value={skepticism}
                onChangeText={setSkepticism}
                multiline
                counter={{ current: skepticism.trim().length, max: PERSONA_LIMITS.skepticism }}
                error={manualErrors.skepticism}
                editable={!busy}
              />
              {stylePresets.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                  {stylePresets.map((preset) => (
                    <Chip
                      key={preset}
                      label={preset}
                      selectable
                      selected={style === preset}
                      onPress={() => setStyle(style === preset ? '' : preset)}
                    />
                  ))}
                </View>
              ) : null}
              <TextField
                label="Communication style (optional)"
                value={style}
                onChangeText={setStyle}
                counter={{ current: style.trim().length, max: PERSONA_LIMITS.style }}
                error={manualErrors.style}
                editable={!busy}
              />
            </View>
          ) : (
            <View style={{ gap: theme.spacing.md }}>
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="caption" color="secondary">
                  Scenario this buyer is for
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                  {scenarioOptions.map((s) => (
                    <Chip key={s.type} label={s.label} selectable selected={scenario === s.type} onPress={() => setScenario(s.type)} />
                  ))}
                </View>
              </View>

              {mode === 'pasted_text' ? (
                <TextField
                  label="Paste a LinkedIn profile, email thread or notes about the buyer"
                  value={pastedText}
                  onChangeText={setPastedText}
                  multiline
                  counter={{ current: pastedText.trim().length, max: PERSONA_LIMITS.pastedText }}
                  error={sourceError}
                  editable={!busy}
                />
              ) : null}
              {mode === 'url' ? (
                <TextField
                  label="Website address"
                  value={url}
                  onChangeText={setUrl}
                  placeholder="https://company.com"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  error={sourceError}
                  editable={!busy}
                />
              ) : null}
              {mode === 'upload' ? (
                <View style={{ gap: theme.spacing.sm }}>
                  <Text variant="caption" color="secondary">
                    PDF, DOCX, TXT, PNG or JPG, up to 10MB
                  </Text>
                  <Button label={file ? 'Choose a different file' : 'Choose a file'} variant="secondary" onPress={pickFile} disabled={busy} />
                  {file ? <Text variant="body">{file.name}</Text> : null}
                  {fileError || sourceError ? (
                    <Text variant="caption" color="negative">
                      {fileError ?? sourceError}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              <Text variant="caption" color="tertiary">
                Building a buyer from a source takes a moment — you can leave this screen while it finishes.
              </Text>
            </View>
          )}

          <Button
            label={mode === 'manual' ? 'Create buyer' : upload.isPending ? 'Uploading…' : 'Generate buyer'}
            variant="primary"
            fullWidth
            loading={busy}
            onPress={handleSubmit}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

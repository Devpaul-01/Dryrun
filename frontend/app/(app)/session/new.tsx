import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Chip, Text, TextField } from '@/components/ui';
import { GENERATING_NAME, usePersonas, useScenarioCatalog } from '@/hooks/usePersonas';
import { useCreateSession } from '@/hooks/useSessions';
import { useTheme } from '@/theme/ThemeProvider';
import type { DifficultyLevel, GoalType, PressureModifier, ScenarioType } from '@/types/api';
import { isApiException, isFeatureGateException } from '@/types/errors';
import {
  DIFFICULTY_OPTIONS,
  GOAL_CUSTOM_MAX,
  GOAL_OPTIONS,
  MAX_PRESSURE,
  buildCreateSessionRequest,
  togglePressure,
  validateSetup,
} from '@/utils/sessionSetup';

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={{ gap: 2 }}>
        <Text variant="heading">{title}</Text>
        {hint ? (
          <Text variant="caption" color="secondary">
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** Session setup wizard (architecture doc §7.4): scenario, buyer, pressure, difficulty, goal, then start. */
export default function NewSession() {
  const theme = useTheme();
  const router = useRouter();
  const catalog = useScenarioCatalog();
  const personas = usePersonas();
  const create = useCreateSession();

  // A curriculum recommendation can hand over a scenario to preselect.
  const { scenario: presetScenario } = useLocalSearchParams<{ scenario?: string }>();
  const [scenario, setScenario] = useState<ScenarioType | null>((presetScenario as ScenarioType | undefined) ?? null);
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [pressure, setPressure] = useState<PressureModifier[]>([]);
  const [difficulty, setDifficulty] = useState<DifficultyLevel | null>(null);
  const [goal, setGoal] = useState<GoalType | null>(null);
  const [customGoal, setCustomGoal] = useState('');
  const [touched, setTouched] = useState(false);

  const selection = { scenario, personaId, pressure, difficulty, goal, customGoal };
  const problem = touched ? validateSetup(selection) : undefined;
  const readyPersonas = (personas.data?.pages.flatMap((p) => p.items) ?? []).filter((p) => p.name !== GENERATING_NAME);
  const atPressureLimit = pressure.length >= MAX_PRESSURE;

  const errorMessage = create.isError
    ? isFeatureGateException(create.error)
      ? create.error.body.message
      : isApiException(create.error)
        ? (create.error.body?.message ?? 'Could not start the session.')
        : 'Could not start the session. Check your connection and try again.'
    : undefined;

  function start() {
    setTouched(true);
    if (validateSetup(selection)) return;
    create.mutate(buildCreateSessionRequest(selection), {
      onSuccess: (session) => router.replace(`/(app)/session/${session.id}/live`),
    });
  }

  // Without a saved buyer the backend generates one inline, which takes a few seconds.
  if (create.isPending) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas, justifyContent: 'center', padding: theme.layout.screenPaddingPhone, gap: theme.spacing.sm }}>
        <Text variant="title" style={{ textAlign: 'center' }}>
          {personaId ? 'Setting the scene…' : 'Building your buyer…'}
        </Text>
        <Text variant="body" color="secondary" style={{ textAlign: 'center' }}>
          This takes a few seconds.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.xl }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="title">New session</Text>
            <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
          </View>

          {errorMessage ? (
            <Card style={{ backgroundColor: theme.colors.bg.elevated, borderColor: theme.colors.signal.negative }}>
              <Text variant="caption" color="negative">
                {errorMessage}
              </Text>
            </Card>
          ) : null}

          <Section title="Scenario" hint={scenario ? catalog.data?.scenario_types.find((s) => s.type === scenario)?.description : 'What kind of conversation do you want to practice?'}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {(catalog.data?.scenario_types ?? []).map((s) => (
                <Chip key={s.type} label={s.label} selectable selected={scenario === s.type} onPress={() => setScenario(s.type)} />
              ))}
            </View>
            {problem === 'Choose a scenario' ? (
              <Text variant="caption" color="negative">
                {problem}
              </Text>
            ) : null}
          </Section>

          <Section title="Buyer" hint="Let us build one for this scenario, or reuse one you saved.">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              <Chip label="Build one for me" selectable selected={personaId === null} onPress={() => setPersonaId(null)} />
              {readyPersonas.map((p) => (
                <Chip key={p.id} label={`${p.name} · ${p.role}`} selectable selected={personaId === p.id} onPress={() => setPersonaId(p.id)} />
              ))}
            </View>
            <Button label="Create a new buyer" variant="ghost" onPress={() => router.push('/(app)/persona/new')} />
          </Section>

          <Section title="Pressure" hint={`Optional. Pick up to ${MAX_PRESSURE}.`}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {(catalog.data?.pressure_modifiers ?? []).map((p) => {
                const selected = pressure.includes(p.type);
                return (
                  <Chip
                    key={p.type}
                    label={p.label}
                    selectable
                    selected={selected}
                    disabled={!selected && atPressureLimit}
                    onPress={() => setPressure((cur) => togglePressure(cur, p.type))}
                  />
                );
              })}
            </View>
          </Section>

          <Section title="Difficulty" hint="Automatic follows your skill level.">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              <Chip label="Automatic" selectable selected={difficulty === null} onPress={() => setDifficulty(null)} />
              {DIFFICULTY_OPTIONS.map((d) => (
                <Chip key={d} label={d.charAt(0).toUpperCase() + d.slice(1)} selectable selected={difficulty === d} onPress={() => setDifficulty(d)} />
              ))}
            </View>
          </Section>

          <Section title="Goal" hint="Optional. Tells the buyer what counts as success for you.">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {GOAL_OPTIONS.map((g) => (
                <Chip key={g.type} label={g.label} selectable selected={goal === g.type} onPress={() => setGoal(goal === g.type ? null : g.type)} />
              ))}
            </View>
            {goal === 'custom' ? (
              <TextField
                label="Your goal"
                value={customGoal}
                onChangeText={setCustomGoal}
                counter={{ current: customGoal.trim().length, max: GOAL_CUSTOM_MAX }}
                error={problem && problem !== 'Choose a scenario' ? problem : undefined}
              />
            ) : null}
          </Section>

          <Button label="Start session" variant="primary" fullWidth onPress={start} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

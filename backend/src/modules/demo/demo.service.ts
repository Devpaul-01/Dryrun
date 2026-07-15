import { randomBytes, createHash } from 'crypto';
import { supabaseAdmin } from '../../config/supabase';
import { redisConnection } from '../../config/redis';
import { ApiError } from '../../lib/apiError';
import { generatePersona, generateBuyerReply } from '../ai/ai.service';
import { trackEvent } from '../analytics/analytics.service';
import * as authService from '../auth/auth.service';

const DEMO_MESSAGE_CAP = 8;
const DEMO_RETENTION_HOURS = 48;
const DEMO_CONVERTED_RETENTION_DAYS = 7;

const DEMO_PRESETS: Record<string, { productDescription: string; targetAudience: string; scenarioType: string }> = {
  saas: { productDescription: 'A project management tool for small teams', targetAudience: 'busy operations managers', scenarioType: 'cold_open' },
  services: { productDescription: 'Freelance marketing consulting', targetAudience: 'small business owners', scenarioType: 'cold_open' },
  physical_product: { productDescription: 'A subscription box of specialty coffee', targetAudience: 'coffee enthusiasts', scenarioType: 'cold_open' },
};

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}

export async function startDemo(ip: string, fingerprint: string, category: string) {
  const ipHash = hashIp(ip);
  const redis = redisConnection();
  const rateLimitKey = `demo-abuse:${ipHash}`;
  const activeCount = await redis.incr(rateLimitKey);
  if (activeCount === 1) await redis.expire(rateLimitKey, 24 * 60 * 60);
  if (activeCount > 1) {
    throw ApiError.rateLimited("You've already tried a demo — create a free account to keep going.");
  }

  const preset = DEMO_PRESETS[category] ?? DEMO_PRESETS.saas;
  const persona = await generatePersona({
    workspaceId: 'demo', // demo calls are not workspace-billed; budget/usage tracking is skipped for this synthetic ID
    practiceProfile: { productDescription: preset.productDescription, targetAudience: preset.targetAudience },
    scenarioType: preset.scenarioType,
  });

  const token = randomBytes(24).toString('base64url');
  const { data: demoSession, error } = await supabaseAdmin()
    .from('demo_sessions')
    .insert({
      demo_token_hash: hashToken(token),
      ip_hash: ipHash,
      fingerprint_hash: fingerprint,
      persona_snapshot: persona,
      messages: [],
      expires_at: new Date(Date.now() + DEMO_RETENTION_HOURS * 60 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();
  if (error || !demoSession) throw ApiError.internal('Failed to start demo.');

  await trackEvent('demo_started', {}, { category });
  return { token, persona, scenario_type: preset.scenarioType };
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

async function getDemoSession(token: string) {
  const { data, error } = await supabaseAdmin()
    .from('demo_sessions')
    .select('*')
    .eq('demo_token_hash', hashToken(token))
    .single();
  if (error || !data) throw ApiError.notFound('Demo session not found or has expired.');
  if (new Date(data.expires_at).getTime() < Date.now()) throw ApiError.notFound('This demo session has expired.');
  return data;
}

export async function sendDemoMessage(token: string, content: string) {
  const demo = await getDemoSession(token);
  const messages = (demo.messages as any[]) ?? [];
  const userMessageCount = messages.filter((m) => m.role === 'user').length;

  if (userMessageCount >= DEMO_MESSAGE_CAP) {
    throw ApiError.forbidden('Demo message limit reached. Create a free account to keep practicing.');
  }

  const history = messages.map((m) => ({ role: m.role as 'user' | 'buyer', content: m.content }));

  const { response } = await generateBuyerReply({
    workspaceId: 'demo',
    sessionId: `demo-${demo.id}`,
    messageId: `demo-msg-${messages.length}`,
    personaSnapshot: demo.persona_snapshot,
    scenarioType: 'cold_open',
    pressureModifiers: [],
    difficultyLevel: 'beginner',
    boundedHistory: history,
    newUserMessage: content,
  });

  const updatedMessages = [
    ...messages,
    { role: 'user', content },
    { role: 'buyer', content: response.reply, internal_monologue: response.internal_monologue },
  ];

  await supabaseAdmin().from('demo_sessions').update({ messages: updatedMessages }).eq('id', demo.id);
  await trackEvent('demo_message_sent', {}, {});

  return { reply: response.reply, messages_remaining: DEMO_MESSAGE_CAP - (userMessageCount + 1) };
}

export async function endDemo(token: string) {
  await getDemoSession(token);
  await trackEvent('demo_completed', {}, {});
  return { success: true };
}

export async function getDemoReplay(token: string) {
  const demo = await getDemoSession(token);
  return { messages: demo.messages, persona: demo.persona_snapshot };
}

/**
 * Migrates the demo transcript/persona into the newly created user's real
 * tables and pre-fills Instant Setup from the demo's category — removing
 * the redundant "start from a blank form" friction at exactly the moment a
 * just-converted, high-motivation user is most likely to drop off.
 */
export async function convertDemo(token: string, email: string, password: string) {
  const demo = await getDemoSession(token);
  const { userId } = await authService.signup(email, password);

  const { data: user } = await supabaseAdmin().from('users').select('current_workspace_id').eq('id', userId).single();
  const workspaceId = user!.current_workspace_id!;

  await supabaseAdmin().from('practice_profiles').upsert(
    {
      user_id: userId,
      workspace_id: workspaceId,
      product_description: (demo.persona_snapshot as any).main_pain ? 'Imported from demo' : '',
      target_audience: 'Imported from demo',
    },
    { onConflict: 'user_id,workspace_id' }
  );

  const { data: persona } = await supabaseAdmin()
    .from('personas')
    .insert({
      workspace_id: workspaceId,
      created_by_user_id: userId,
      name: (demo.persona_snapshot as any).name,
      role: (demo.persona_snapshot as any).role,
      main_pain: (demo.persona_snapshot as any).main_pain,
      skepticism_about: (demo.persona_snapshot as any).skepticism_about,
      communication_style: (demo.persona_snapshot as any).communication_style,
      source_type: 'generated',
      reusable: true,
    })
    .select('id')
    .single();

  const { data: session } = await supabaseAdmin()
    .from('practice_sessions')
    .insert({
      user_id: userId,
      workspace_id: workspaceId,
      persona_id: persona?.id,
      persona_snapshot: demo.persona_snapshot,
      scenario_type: 'cold_open',
      status: 'completed',
      title: 'Your first practice session (from demo)',
      is_demo: true,
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  const messages = (demo.messages as any[]) ?? [];
  for (let i = 0; i < messages.length; i++) {
    await supabaseAdmin()
      .from('session_messages')
      .insert({
        session_id: session!.id,
        role: messages[i].role,
        content: messages[i].content,
        internal_monologue: messages[i].internal_monologue ?? null,
        sequence_index: i,
      });
  }

  await supabaseAdmin()
    .from('demo_sessions')
    .update({
      converted_to_user_id: userId,
      expires_at: new Date(Date.now() + DEMO_CONVERTED_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    })
    .eq('id', demo.id);

  await trackEvent('demo_converted', { userId, workspaceId }, {});
  return { userId, workspaceId, sessionId: session!.id };
}

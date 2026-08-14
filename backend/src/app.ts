import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import * as Sentry from '@sentry/node';
import { env } from './config/env';
import { requestId } from './middleware/requestId';
import { securityHeaders } from './middleware/securityHeaders';
import { requestLogging } from './middleware/requestLogging';
import { authenticate } from './middleware/authenticate';
import { resolveWorkspace } from './middleware/resolveWorkspace';
import { requireAdmin } from './middleware/requireAdmin';
import { errorHandler } from './middleware/errorHandler';
import { defaultRateLimit } from './middleware/rateLimit';

import authRoutes from './modules/auth/auth.routes';
import emailHookRoutes from './modules/auth/emailHook.routes';
import profileRoutes from './modules/auth/profile.routes';
import notificationPreferencesRoutes from './modules/auth/notificationPreferences.routes';
import exportRoutes from './modules/auth/export.routes';
import workspaceRoutes from './modules/workspace/workspace.routes';
import onboardingRoutes from './modules/practice/onboarding.routes';
import dashboardRoutes from './modules/practice/dashboard.routes';
import sessionRoutes from './modules/practice/session.routes';
import personaRoutes from './modules/practice/persona.routes';
import playbookRoutes, { publicPlaybookRouter } from './modules/coaching/playbook.routes';
import badgesRoutes from './modules/coaching/badges.routes';
import skillTrendRoutes from './modules/coaching/skillTrend.routes';
import curriculumRoutes from './modules/coaching/curriculum.routes';
import billingRoutes from './modules/billing/billing.routes';
import webhookRoutes from './modules/billing/webhook.routes';
import uploadRoutes from './modules/files/upload.routes';
import notificationsRoutes from './modules/notifications/notifications.routes';
import analyticsRoutes from './modules/analytics/analytics.routes';
import demoRoutes from './modules/demo/demo.routes';
import adminRoutes from './modules/admin/admin.routes';
import healthRoutes from './modules/health/health.routes';

if (env.sentry.dsn) {
  Sentry.init({ dsn: env.sentry.dsn, environment: env.sentry.environment, tracesSampleRate: 0.1 });
}

const app = express();

// Steps 1-3 of the global middleware stack.
app.use(requestId);
app.use(securityHeaders);
app.set('trust proxy', 1);
app.use(
  cors({
    // CORS here is browser-compatibility only, NOT the security boundary --
    // every API request is authenticated via Bearer JWT regardless of
    // origin (architecture doc, frontend platform blueprint 5.3). Native
    // mobile clients don't send an Origin header at all and are unaffected
    // by this configuration.
    origin: (origin, callback) => {
      const allowed = [env.frontendUrl, 'http://localhost:5173', 'http://localhost:3000'];
      if (!origin || allowed.includes(origin)) callback(null, true);
      else callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);
app.use(cookieParser());

// MUST be mounted before express.json() below — this route needs the
// exact raw request body bytes for Standard Webhooks signature
// verification (see modules/auth/emailHook.routes.ts's header comment
// for the full rationale and why this differs from the Flutterwave
// webhook's mounting, which is fine after JSON parsing). As a
// consequence this route also runs before `requestLogging` and won't
// appear in the automatic pino-http access log — it logs its own
// success/failure explicitly instead (see emailHook.routes.ts).
app.use('/api/v1/auth/email-hook', express.raw({ type: 'application/json' }), emailHookRoutes);

app.use(express.json({ limit: '1mb' })); // request-size sanity bound (19.6) -- schemas further bound individual fields
app.use(requestLogging);

// Health checks -- unauthenticated.
app.use('/health', healthRoutes);

// Public, unauthenticated routes.
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/demo', demoRoutes);
app.use('/api/v1/public', publicPlaybookRouter);
app.use('/api/v1/billing/webhooks', webhookRoutes); // provider-signature-verified, not user-authenticated

// Authenticated routes: steps 4-5 (authenticate, resolveWorkspace).
const authed = [authenticate, resolveWorkspace, defaultRateLimit];

app.use('/api/v1/user', authenticate, profileRoutes); // exposes PATCH/DELETE /me — split from user.routes.ts (item #14)
app.use('/api/v1/user', authenticate, notificationPreferencesRoutes); // exposes /notification-preferences
app.use('/api/v1/user', authenticate, exportRoutes); // exposes /export
app.use('/api/v1/workspaces', ...authed, workspaceRoutes);
app.use('/api/v1/onboarding', ...authed, onboardingRoutes);
app.use('/api/v1/dashboard', ...authed, dashboardRoutes);
app.use('/api/v1/sessions', ...authed, sessionRoutes);
app.use('/api/v1', ...authed, personaRoutes); // exposes /scenarios and /personas
app.use('/api/v1', ...authed, playbookRoutes); // exposes /playbooks (split from coaching.routes.ts, see item #14)
app.use('/api/v1', ...authed, badgesRoutes); // exposes /badges
app.use('/api/v1', ...authed, skillTrendRoutes); // exposes /skill-trend, /skill-trend/goals
app.use('/api/v1', ...authed, curriculumRoutes); // exposes /curriculum/current, /curriculum/dismiss
app.use('/api/v1/billing', ...authed, billingRoutes);
app.use('/api/v1/uploads', ...authed, uploadRoutes);
app.use('/api/v1/notifications', ...authed, notificationsRoutes);
app.use('/api/v1/analytics', ...authed, analyticsRoutes);

// Admin -- authenticated + admin-role-gated + optional IP allowlist.
app.use('/api/v1/admin', authenticate, resolveWorkspace, requireAdmin, adminRoutes);

app.use('*', (req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', message: `${req.method} ${req.originalUrl} not found` });
});

// Terminal -- step 10 of the global middleware stack.
app.use(errorHandler);

export default app;

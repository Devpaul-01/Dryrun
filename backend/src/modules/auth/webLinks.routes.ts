import { Router } from 'express';

/**
 * FIX (backend-takeover audit, Task #16 — mobile-readiness review): every
 * email-verification and password-reset link this backend sends
 * (auth.service.ts, generateAndSendVerificationEmail /
 * requestPasswordReset) points to `${env.frontendUrl}${...path}` — i.e.
 * a web frontend. No web frontend exists in this repo, and per the
 * product owner, none is planned yet either; the mobile Expo app hasn't
 * been started. FRONTEND_URL currently defaults to a Vite dev server
 * (localhost:5173) — a user tapping "Confirm your email" or "Reset your
 * password" from their phone's inbox today hits a dead URL.
 *
 * Rather than guess at a mobile deep-link URL scheme the Expo app
 * doesn't register yet (and won't be testable until it exists), these
 * two routes serve minimal, dependency-free HTML pages directly from
 * this backend — no separate frontend needed, no coordination with a
 * URL scheme that isn't decided. They work today for any user,
 * mobile-only or not, since any phone's mail app opens a link in a
 * mobile browser, which can hit this backend exactly like a desktop
 * browser can. The pages' own JS simply calls the existing
 * POST /api/v1/auth/verify-email and POST /api/v1/auth/reset-password
 * endpoints — no new backend logic, just a thin presentation layer for
 * what already exists.
 *
 * The page's script is served same-origin (not inline) so it satisfies
 * the global CSP's default-src 'self' (securityHeaders.ts) with no
 * loosening needed. It's inlined here as a string constant rather than
 * a separate .js file under this module's own directory because
 * tsconfig.json's build only compiles *.ts (`"include": ["**\/*.ts"]`) —
 * a sibling .js file would never get copied to dist/ by `npm run build`,
 * so res.sendFile(path.join(__dirname, ...)) would 404 in production
 * with no build-time error to catch it. Inlining guarantees the script
 * ships wherever this compiled route file ships, with no extra build
 * step to add or forget.
 *
 * When a real web frontend or a mobile deep-link scheme is decided,
 * FRONTEND_URL / VERIFY_EMAIL_REDIRECT_PATH / RESET_PASSWORD_REDIRECT_PATH
 * in auth.service.ts can point there instead and this module can be
 * removed — it's intentionally self-contained so that swap is a
 * one-line change in auth.service.ts, not a migration.
 */
const router = Router();

const PAGE_STYLE = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f6f7f9; color: #1a1a2e; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; box-sizing: border-box; }
  .card { background: #fff; border-radius: 12px; padding: 32px; max-width: 400px; width: 100%; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  h1 { font-size: 20px; margin: 0 0 16px; }
  p { line-height: 1.5; color: #444; }
  label { display: block; font-size: 14px; font-weight: 600; margin: 16px 0 6px; }
  input[type="password"] { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #d0d3d9; border-radius: 8px; font-size: 16px; }
  button { margin-top: 20px; width: 100%; padding: 12px; border: none; border-radius: 8px; background: #4f46e5; color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  #status { margin-top: 16px; font-size: 14px; min-height: 20px; }
  #status.success { color: #0a7d3f; }
  #status.error { color: #c0392b; }
`;

const VERIFY_EMAIL_JS = `(async function () {
  const statusEl = document.getElementById('status');
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  if (!token) {
    statusEl.textContent = 'This link is missing a verification token. Please use the link from your email exactly as sent.';
    statusEl.className = 'error';
    return;
  }

  try {
    const res = await fetch('/api/v1/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const body = await res.json().catch(() => ({}));

    if (res.ok) {
      statusEl.textContent = 'Your email is verified. You can close this page and return to the DryRun app.';
      statusEl.className = 'success';
    } else if (res.status === 429 && body.retry_after_seconds) {
      statusEl.textContent = 'Too many attempts. Please try again in ' + body.retry_after_seconds + ' seconds.';
      statusEl.className = 'error';
    } else {
      statusEl.textContent = body.message || 'This link is invalid or has expired. Please request a new verification email from the app.';
      statusEl.className = 'error';
    }
  } catch (e) {
    statusEl.textContent = 'Something went wrong. Please check your connection and try again.';
    statusEl.className = 'error';
  }
})();`;

const RESET_PASSWORD_JS = `(function () {
  const form = document.getElementById('reset-form');
  const statusEl = document.getElementById('status');
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  if (!token) {
    statusEl.textContent = 'This link is missing a reset token. Please use the link from your email exactly as sent.';
    statusEl.className = 'error';
    form.style.display = 'none';
    return;
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    statusEl.textContent = '';
    statusEl.className = '';

    const newPassword = document.getElementById('password').value;
    const confirmPassword = document.getElementById('password-confirm').value;

    if (newPassword !== confirmPassword) {
      statusEl.textContent = 'Passwords do not match.';
      statusEl.className = 'error';
      return;
    }
    if (newPassword.length < 8) {
      statusEl.textContent = 'Password must be at least 8 characters.';
      statusEl.className = 'error';
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const res = await fetch('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, newPassword: newPassword }),
      });
      const body = await res.json().catch(() => ({}));

      if (res.ok) {
        statusEl.textContent = 'Your password has been reset. You can close this page and log in from the DryRun app.';
        statusEl.className = 'success';
        form.style.display = 'none';
      } else if (res.status === 429 && body.retry_after_seconds) {
        statusEl.textContent = 'Too many attempts. Please try again in ' + body.retry_after_seconds + ' seconds.';
        statusEl.className = 'error';
        submitBtn.disabled = false;
      } else {
        statusEl.textContent = body.message || 'This link is invalid or has expired. Please request a new password reset from the app.';
        statusEl.className = 'error';
        submitBtn.disabled = false;
      }
    } catch (err) {
      statusEl.textContent = 'Something went wrong. Please check your connection and try again.';
      statusEl.className = 'error';
      submitBtn.disabled = false;
    }
  });
})();`;

router.get('/verify-email', (_req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Verify your email — DryRun</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<div class="card">
  <h1>Verifying your email&hellip;</h1>
  <p id="status">Please wait.</p>
</div>
<script src="/verify-email.js"></script>
</body>
</html>`);
});

router.get('/reset-password', (_req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Reset your password — DryRun</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<div class="card">
  <h1>Reset your password</h1>
  <form id="reset-form">
    <label for="password">New password</label>
    <input type="password" id="password" minlength="8" maxlength="72" required autocomplete="new-password" />
    <label for="password-confirm">Confirm new password</label>
    <input type="password" id="password-confirm" minlength="8" maxlength="72" required autocomplete="new-password" />
    <button type="submit">Reset password</button>
  </form>
  <p id="status"></p>
</div>
<script src="/reset-password.js"></script>
</body>
</html>`);
});

router.get('/verify-email.js', (_req, res) => {
  res.set('Content-Type', 'application/javascript; charset=utf-8').send(VERIFY_EMAIL_JS);
});
router.get('/reset-password.js', (_req, res) => {
  res.set('Content-Type', 'application/javascript; charset=utf-8').send(RESET_PASSWORD_JS);
});

export default router;

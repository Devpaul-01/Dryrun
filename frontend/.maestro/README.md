# Maestro smoke suite

Critical-path flows for a device/emulator build of the app (`appId: com.dryrun.mobile`,
set in `app.json`). They drive the real UI, so they need a backend to talk to:
point `EXPO_PUBLIC_API_BASE_URL` at a staging or local backend seeded with the test
account below before building the app.

| Flow | Covers |
| --- | --- |
| `auth-login.yaml` | Welcome → login → Home |
| `practice-session.yaml` | Start a session, send a message, end it, reach the debrief |
| `demo-funnel.yaml` | Signed-out demo: start, send a message, end, see the replay and the signup form |
| `settings.yaml` | Account hub → profile edit → notification toggles → back |

```sh
# Install: https://maestro.mobile.dev/getting-started/installing-maestro
export MAESTRO_EMAIL=smoke@example.com MAESTRO_PASSWORD='...'
maestro test .maestro            # everything
maestro test .maestro/auth-login.yaml
```

Flows use visible text (no testIDs) so they double as a check that labels are accessible.

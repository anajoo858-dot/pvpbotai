# PvPBotAI

A session-isolated Minecraft dashboard prototype with PostgreSQL persistence.

## Included
- PostgreSQL-backed profiles and workspace ownership.
- PostgreSQL-backed Express sessions, surviving server restarts and deployments.
- A separate workspace per browser session, enforced in every profile query.
- Create, load, edit, delete, and export profiles.
- Profile validation and a 20-profile per-session limit.
- CSRF checks, rate limiting, Helmet security headers, and HTTP-only cookies.
- Profile exports use an explicit allowlist; API keys and secrets are never exported.
- Loading a profile only restores settings. It does not connect to Minecraft or start automation.

## Setup
1. Provision a **persistent PostgreSQL database** with a provider of your choice.
2. Set `DATABASE_URL` to its connection string. Set `DATABASE_SSL=require` if the provider requires TLS.
3. Set `SESSION_SECRET` to a long random secret.
4. Set `NODE_ENV=production` when deployed behind HTTPS.
5. Run `npm install`, then `npm start`.
6. The app creates its required database tables on startup.

For local development, copy `.env.example` to `.env` and fill in the database connection details. A PostgreSQL server must be available; this version no longer falls back to temporary in-memory storage.

## Persistence and privacy notes
- Profiles are permanent for the same browser session as long as the browser retains its session cookie and the PostgreSQL database is retained.
- Clearing cookies or using another browser creates a different workspace. Cross-device profile access requires user accounts; that is a planned next step.
- Use a managed persistent database. Do not use an ephemeral database or delete the database volume if you need to retain profiles.
- The app scopes every profile read/write/delete to the workspace ID stored in that browser's server-side session.
- This prototype has no public bot-start endpoint and does not connect to Minecraft.
- Never commit `.env`, Gemini API keys, access tokens, or passwords. Store secrets in the hosting provider's secret manager.
- Before public launch, add authenticated accounts, account recovery, database backups, and automated isolation tests.

## Next steps
1. Add account login so users can access their own profiles across devices.
2. Add automated tests for session isolation and profile ownership.
3. Add a server-side Gemini decision service with strict usage limits.
4. Only then consider an authorized Minecraft runtime with explicit manual connection controls.

# PvPBotAI

A session-isolated Minecraft dashboard prototype with a profile manager.

## Included
- Separate temporary workspace for each browser session.
- Sample **Main SMP** profile.
- Create, load, and delete profiles; export profiles as JSON.
- Profile validation and a 20-profile per-session limit.
- CSRF token checks, rate limiting, Helmet security headers, and HTTP-only session cookies.
- Profile exports use an explicit field allowlist, so API keys and secrets are never exported.
- Loading a profile only restores settings. It does not connect to Minecraft or start automation.

## Run locally
1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set a long random `SESSION_SECRET`.
4. Run `npm run dev`.
5. Open `http://localhost:3000`.

## Important prototype limits
- Workspace data and Express sessions currently use in-memory storage. Data is temporary and this is **not production-ready**. Before deployment, replace both with a persistent session store and database, and enforce ownership in every database query.
- There is intentionally no public bot-start endpoint and no Minecraft connection implementation in this prototype.
- Any future runtime must be restricted to servers where the operator has permission, protected by authentication and per-user ownership checks, and started only through an explicit user action.
- Never commit `.env`, Gemini API keys, access tokens, or passwords. Store secrets in the hosting provider's secret manager.
- Do not expose an unauthenticated public endpoint that lets visitors connect bots to arbitrary servers.

## Next engineering steps
1. Add automated tests for session isolation and profile ownership.
2. Replace in-memory workspaces and Express MemoryStore with persistent, owner-scoped storage.
3. Add authenticated accounts and deployment hardening.
4. Add a server-side Gemini decision service with strict usage limits.
5. Only then consider an authorized Minecraft runtime and manual connection controls.

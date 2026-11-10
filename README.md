# PvPBotAI

A session-isolated Minecraft dashboard prototype.

## Current features
- Private workspace per browser session.
- A sample **Main SMP** profile.
- Load Profile restores the visible settings only; it does **not** connect or launch a bot.
- Basic validation, rate limiting, Helmet security headers, HTTP-only session cookies, and CSRF token checks.
- Gemini configuration placeholder; API keys are never placed in browser code or profile exports.

## Run locally
1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set a long random `SESSION_SECRET`.
4. Run `npm run dev`.
5. Open `http://localhost:3000`.

## Important prototype limits
- Workspaces currently use in-memory storage and Express's default session store. Data is temporary and this is **not production-ready**. Before deployment, use a persistent session store (such as Redis) and a database with strict user/workspace ownership.
- This prototype intentionally has no public bot-start endpoint and does not connect to Minecraft. Add runtime controls only for servers where you have permission, with authentication, ownership checks, abuse limits, and an explicit manual connect action.
- Never commit `.env`, API keys, access tokens, or passwords. Store secrets in the hosting provider's secret manager.
- A browser session is isolated from other sessions at the application layer; production isolation must also be enforced by the persistent database's ownership rules.

## Planned next steps
1. Add profile create/edit/duplicate/delete endpoints and UI.
2. Add authenticated persistent accounts and Redis/database storage.
3. Add a server-side Gemini decision service with strict request limits.
4. Add an authorized Mineflayer runtime and explicit manual connection controls.
5. Add tests for session isolation and profile ownership.
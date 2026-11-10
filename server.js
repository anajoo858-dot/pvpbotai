const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);

if (isProduction && !process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is required in production.");
if (isProduction) app.set("trust proxy", 1);

app.use(helmet());
app.use(express.json({ limit: "32kb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: "draft-8", legacyHeaders: false }));
app.use(session({
  name: "pvpbotai.sid",
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: isProduction, sameSite: "lax", maxAge: 1000 * 60 * 60 * 8 }
}));

// Prototype-only isolation. Replace this Map and Express MemoryStore with a
// persistent database/session store before deployment, enforcing owner IDs in every query.
const workspaces = new Map();
function workspaceFor(req) {
  if (!req.session.workspaceId) req.session.workspaceId = crypto.randomUUID();
  if (!workspaces.has(req.session.workspaceId)) {
    workspaces.set(req.session.workspaceId, {
      profiles: [{
        id: "main-smp", name: "Main SMP", botName: "GeminiBot",
        serverHost: "play.example.net", serverPort: 25565,
        minecraftVersion: "auto", aiProvider: "Gemini", thinkingLevel: "medium",
        updatedAt: new Date().toISOString()
      }],
      selectedProfileId: "main-smp",
      botStatus: "disconnected"
    });
  }
  return workspaces.get(req.session.workspaceId);
}
app.use((req, res, next) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString("hex");
  next();
});
function requireCsrf(req, res, next) {
  if (req.get("x-csrf-token") !== req.session.csrfToken) return res.status(403).json({ error: "Invalid session token. Refresh the page and try again." });
  next();
}
function cleanText(value, max) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function validateProfile(input) {
  const name = cleanText(input?.name, 40);
  const botName = cleanText(input?.botName, 16);
  const serverHost = cleanText(input?.serverHost, 253);
  const serverPort = Number(input?.serverPort || 25565);
  const minecraftVersion = cleanText(input?.minecraftVersion || "auto", 20);
  const thinkingLevel = ["low", "medium", "high"].includes(input?.thinkingLevel) ? input.thinkingLevel : "medium";
  if (!name) return { error: "Enter a profile name." };
  if (!/^[A-Za-z0-9_]{3,16}$/.test(botName)) return { error: "Bot name must be 3–16 letters, numbers, or underscores." };
  if (!serverHost || !/^[a-zA-Z0-9.-]+$/.test(serverHost) || serverHost.startsWith(".") || serverHost.endsWith(".")) return { error: "Enter a valid hostname without a URL or protocol." };
  if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) return { error: "Port must be between 1 and 65535." };
  return { value: { name, botName, serverHost, serverPort, minecraftVersion, aiProvider: "Gemini", thinkingLevel } };
}
function publicProfile(profile) {
  // Deliberately whitelist fields: API keys and other secrets never enter profiles or exports.
  const { id, name, botName, serverHost, serverPort, minecraftVersion, aiProvider, thinkingLevel, updatedAt } = profile;
  return { id, name, botName, serverHost, serverPort, minecraftVersion, aiProvider, thinkingLevel, updatedAt };
}

app.get("/api/bootstrap", (req, res) => {
  const ws = workspaceFor(req);
  res.json({ csrfToken: req.session.csrfToken, profiles: ws.profiles.map(publicProfile), selectedProfileId: ws.selectedProfileId, botStatus: ws.botStatus });
});
app.get("/api/profiles", (req, res) => res.json({ profiles: workspaceFor(req).profiles.map(publicProfile) }));
app.post("/api/profiles", requireCsrf, (req, res) => {
  const parsed = validateProfile(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const ws = workspaceFor(req);
  if (ws.profiles.length >= 20) return res.status(400).json({ error: "This session can store up to 20 profiles." });
  const profile = { id: crypto.randomUUID(), ...parsed.value, updatedAt: new Date().toISOString() };
  ws.profiles.push(profile);
  res.status(201).json({ profile: publicProfile(profile), profiles: ws.profiles.map(publicProfile) });
});
app.put("/api/profiles/:id", requireCsrf, (req, res) => {
  const ws = workspaceFor(req);
  const index = ws.profiles.findIndex(item => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Profile not found in this session." });
  const parsed = validateProfile(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  ws.profiles[index] = { ...ws.profiles[index], ...parsed.value, updatedAt: new Date().toISOString() };
  res.json({ profile: publicProfile(ws.profiles[index]), profiles: ws.profiles.map(publicProfile) });
});
app.delete("/api/profiles/:id", requireCsrf, (req, res) => {
  const ws = workspaceFor(req);
  if (!ws.profiles.some(item => item.id === req.params.id)) return res.status(404).json({ error: "Profile not found in this session." });
  ws.profiles = ws.profiles.filter(item => item.id !== req.params.id);
  if (ws.selectedProfileId === req.params.id) ws.selectedProfileId = ws.profiles[0]?.id || null;
  res.json({ profiles: ws.profiles.map(publicProfile), selectedProfileId: ws.selectedProfileId });
});
app.post("/api/profiles/:id/load", requireCsrf, (req, res) => {
  const ws = workspaceFor(req);
  const profile = ws.profiles.find(item => item.id === req.params.id);
  if (!profile) return res.status(404).json({ error: "Profile not found in this session." });
  ws.selectedProfileId = profile.id;
  res.json({ profile: publicProfile(profile), botStatus: ws.botStatus, connected: false, message: "Profile loaded. Settings restored; no bot was connected." });
});
app.get("/api/profiles/export", (req, res) => {
  const ws = workspaceFor(req);
  res.json({ format: "pvpbotai-profiles-v1", profiles: ws.profiles.map(({ name, botName, serverHost, serverPort, minecraftVersion, aiProvider, thinkingLevel }) => ({ name, botName, serverHost, serverPort, minecraftVersion, aiProvider, thinkingLevel })) });
});
app.get("/api/state", (req, res) => res.json({ botStatus: workspaceFor(req).botStatus, connected: false, note: "Minecraft runtime is not connected in this prototype." }));
app.use(express.static(path.join(__dirname, "public")));
app.get("/{*splat}", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(port, () => console.log(`PvPBotAI dashboard listening on http://localhost:${port}`));

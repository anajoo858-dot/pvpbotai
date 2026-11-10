const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required in production.");
}
if (isProduction) app.set("trust proxy", 1);

app.use(helmet());
app.use(express.json({ limit: "32kb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: "draft-8", legacyHeaders: false }));
app.use(session({
  name: "pvpbotai.sid",
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

// Prototype storage: each browser session gets its own isolated workspace.
// Replace MemoryStore + this Map with a persistent session store/database before production.
const workspaces = new Map();
function workspaceFor(req) {
  if (!req.session.workspaceId) req.session.workspaceId = crypto.randomUUID();
  if (!workspaces.has(req.session.workspaceId)) {
    workspaces.set(req.session.workspaceId, {
      profiles: [{
        id: "main-smp",
        name: "Main SMP",
        botName: "GeminiBot",
        serverHost: "play.example.net",
        serverPort: 25565,
        minecraftVersion: "auto",
        aiProvider: "Gemini",
        thinkingLevel: "medium",
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
  res.locals.csrfToken = req.session.csrfToken;
  next();
});
function requireCsrf(req, res, next) {
  if (req.get("x-csrf-token") !== req.session.csrfToken) {
    return res.status(403).json({ error: "Invalid session token. Refresh the page and try again." });
  }
  next();
}
function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
function validateProfile(input) {
  const name = cleanText(input?.name, 40);
  const botName = cleanText(input?.botName, 16);
  const serverHost = cleanText(input?.serverHost, 253);
  const serverPort = Number(input?.serverPort || 25565);
  const minecraftVersion = cleanText(input?.minecraftVersion || "auto", 20);
  const thinkingLevel = ["low", "medium", "high"].includes(input?.thinkingLevel) ? input.thinkingLevel : "medium";
  if (!name || !/^[A-Za-z0-9_]{3,16}$/.test(botName)) return { error: "Enter a profile name and a Minecraft-style bot name (3–16 letters, numbers, or underscores)." };
  if (!serverHost || !/^[a-zA-Z0-9.-]+$/.test(serverHost) || serverHost.startsWith(".") || serverHost.endsWith(".")) return { error: "Enter a valid server hostname. Do not include a URL or protocol." };
  if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) return { error: "Port must be between 1 and 65535." };
  return { value: { name, botName, serverHost, serverPort, minecraftVersion, aiProvider: "Gemini", thinkingLevel } };
}

app.get("/api/bootstrap", (req, res) => {
  const ws = workspaceFor(req);
  res.json({ csrfToken: req.session.csrfToken, profiles: ws.profiles, selectedProfileId: ws.selectedProfileId, botStatus: ws.botStatus });
});
app.get("/api/profiles", (req, res) => res.json({ profiles: workspaceFor(req).profiles }));
app.post("/api/profiles", requireCsrf, (req, res) => {
  const parsed = validateProfile(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const ws = workspaceFor(req);
  if (ws.profiles.length >= 20) return res.status(400).json({ error: "This session can store up to 20 profiles." });
  const profile = { id: crypto.randomUUID(), ...parsed.value, updatedAt: new Date().toISOString() };
  ws.profiles.push(profile);
  res.status(201).json({ profile });
});
app.post("/api/profiles/:id/load", requireCsrf, (req, res) => {
  const ws = workspaceFor(req);
  const profile = ws.profiles.find(item => item.id === req.params.id);
  if (!profile) return res.status(404).json({ error: "Profile not found in this session." });
  // Loading only fills the dashboard settings. It never connects or starts a bot.
  ws.selectedProfileId = profile.id;
  res.json({ profile, botStatus: ws.botStatus, connected: false, message: "Profile loaded. Review the settings, then connect manually when that feature is implemented." });
});
app.get("/api/state", (req, res) => {
  const ws = workspaceFor(req);
  res.json({ botStatus: ws.botStatus, connected: false, note: "Connection controls are intentionally disabled in this prototype." });
});
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(port, () => console.log(`PvPBotAI dashboard listening on http://localhost:${port}`));
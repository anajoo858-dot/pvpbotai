const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 365;

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required. Configure a persistent PostgreSQL database.");
if (isProduction && !process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is required in production.");
if (isProduction) app.set("trust proxy", 1);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: false } : undefined
});

app.use(helmet());
app.use(express.json({ limit: "32kb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: "draft-8", legacyHeaders: false }));
app.use(session({
  store: new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true,
    ttl: Math.floor(SESSION_MAX_AGE / 1000)
  }),
  name: "pvpbotai.sid",
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: isProduction, sameSite: "lax", maxAge: SESSION_MAX_AGE }
}));

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id UUID PRIMARY KEY,
      selected_profile_id UUID NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id UUID PRIMARY KEY,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name VARCHAR(40) NOT NULL,
      bot_name VARCHAR(16) NOT NULL,
      server_host VARCHAR(253) NOT NULL,
      server_port INTEGER NOT NULL,
      minecraft_version VARCHAR(20) NOT NULL DEFAULT 'auto',
      ai_provider VARCHAR(30) NOT NULL DEFAULT 'Gemini',
      thinking_level VARCHAR(10) NOT NULL DEFAULT 'medium',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS profiles_workspace_id_idx ON profiles(workspace_id)");
}

async function ensureWorkspace(req) {
  if (!req.session.workspaceId) req.session.workspaceId = crypto.randomUUID();
  const workspaceId = req.session.workspaceId;
  const inserted = await pool.query(
    "INSERT INTO workspaces (id) VALUES ($1) ON CONFLICT (id) DO NOTHING RETURNING id",
    [workspaceId]
  );
  if (inserted.rowCount > 0) {
    const profileId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO profiles (id, workspace_id, name, bot_name, server_host, server_port, minecraft_version, ai_provider, thinking_level)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [profileId, workspaceId, "Main SMP", "GeminiBot", "play.example.net", 25565, "auto", "Gemini", "medium"]
    );
    await pool.query("UPDATE workspaces SET selected_profile_id = $1 WHERE id = $2", [profileId, workspaceId]);
  }
  return workspaceId;
}
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
function publicProfile(row) {
  return {
    id: row.id, name: row.name, botName: row.bot_name, serverHost: row.server_host,
    serverPort: row.server_port, minecraftVersion: row.minecraft_version,
    aiProvider: row.ai_provider, thinkingLevel: row.thinking_level,
    updatedAt: row.updated_at
  };
}
async function listProfiles(workspaceId) {
  const result = await pool.query("SELECT * FROM profiles WHERE workspace_id = $1 ORDER BY updated_at DESC", [workspaceId]);
  return result.rows.map(publicProfile);
}
async function getProfile(workspaceId, id) {
  const result = await pool.query("SELECT * FROM profiles WHERE workspace_id = $1 AND id = $2", [workspaceId, id]);
  return result.rows[0] ? publicProfile(result.rows[0]) : null;
}

app.use(async (req, res, next) => {
  try {
    await ensureWorkspace(req);
    if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString("hex");
    next();
  } catch (error) {
    console.error("Workspace initialization failed:", error);
    res.status(503).json({ error: "Database unavailable. Please try again later." });
  }
});

app.get("/api/bootstrap", async (req, res) => {
  const profiles = await listProfiles(req.session.workspaceId);
  const ws = await pool.query("SELECT selected_profile_id FROM workspaces WHERE id = $1", [req.session.workspaceId]);
  res.json({ csrfToken: req.session.csrfToken, profiles, selectedProfileId: ws.rows[0]?.selected_profile_id || null, botStatus: "disconnected" });
});
app.get("/api/profiles", async (req, res) => res.json({ profiles: await listProfiles(req.session.workspaceId) }));
app.post("/api/profiles", requireCsrf, async (req, res) => {
  const parsed = validateProfile(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const workspaceId = req.session.workspaceId;
  const count = await pool.query("SELECT COUNT(*)::int AS count FROM profiles WHERE workspace_id = $1", [workspaceId]);
  if (count.rows[0].count >= 20) return res.status(400).json({ error: "This session can store up to 20 profiles." });
  const p = parsed.value;
  const id = crypto.randomUUID();
  const result = await pool.query(
    `INSERT INTO profiles (id,workspace_id,name,bot_name,server_host,server_port,minecraft_version,ai_provider,thinking_level)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [id,workspaceId,p.name,p.botName,p.serverHost,p.serverPort,p.minecraftVersion,p.aiProvider,p.thinkingLevel]
  );
  res.status(201).json({ profile: publicProfile(result.rows[0]), profiles: await listProfiles(workspaceId) });
});
app.put("/api/profiles/:id", requireCsrf, async (req, res) => {
  const parsed = validateProfile(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const p = parsed.value;
  const result = await pool.query(
    `UPDATE profiles SET name=$1,bot_name=$2,server_host=$3,server_port=$4,minecraft_version=$5,ai_provider=$6,thinking_level=$7,updated_at=NOW()
     WHERE workspace_id=$8 AND id=$9 RETURNING *`,
    [p.name,p.botName,p.serverHost,p.serverPort,p.minecraftVersion,p.aiProvider,p.thinkingLevel,req.session.workspaceId,req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Profile not found in this session." });
  res.json({ profile: publicProfile(result.rows[0]), profiles: await listProfiles(req.session.workspaceId) });
});
app.delete("/api/profiles/:id", requireCsrf, async (req, res) => {
  const workspaceId = req.session.workspaceId;
  const result = await pool.query("DELETE FROM profiles WHERE workspace_id=$1 AND id=$2 RETURNING id", [workspaceId,req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Profile not found in this session." });
  await pool.query("UPDATE workspaces SET selected_profile_id = (SELECT id FROM profiles WHERE workspace_id=$1 ORDER BY updated_at DESC LIMIT 1) WHERE id=$1 AND selected_profile_id=$2", [workspaceId,req.params.id]);
  const ws = await pool.query("SELECT selected_profile_id FROM workspaces WHERE id=$1", [workspaceId]);
  res.json({ profiles: await listProfiles(workspaceId), selectedProfileId: ws.rows[0]?.selected_profile_id || null });
});
app.post("/api/profiles/:id/load", requireCsrf, async (req, res) => {
  const workspaceId = req.session.workspaceId;
  const profile = await getProfile(workspaceId, req.params.id);
  if (!profile) return res.status(404).json({ error: "Profile not found in this session." });
  await pool.query("UPDATE workspaces SET selected_profile_id=$1 WHERE id=$2", [profile.id,workspaceId]);
  res.json({ profile, botStatus: "disconnected", connected: false, message: "Profile loaded. Settings restored; no bot was connected." });
});
app.get("/api/profiles/export", async (req, res) => {
  const profiles = await listProfiles(req.session.workspaceId);
  res.json({ format: "pvpbotai-profiles-v1", profiles: profiles.map(({ name, botName, serverHost, serverPort, minecraftVersion, aiProvider, thinkingLevel }) => ({ name, botName, serverHost, serverPort, minecraftVersion, aiProvider, thinkingLevel })) });
});
app.get("/api/state", (req, res) => res.json({ botStatus: "disconnected", connected: false, note: "Minecraft runtime is not connected in this prototype." }));
app.use(express.static(path.join(__dirname, "public")));
app.get("/{*splat}", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

initializeDatabase().then(() => {
  app.listen(port, () => console.log(`PvPBotAI dashboard listening on port ${port}`));
}).catch(error => {
  console.error("Database initialization failed:", error);
  process.exit(1);
});

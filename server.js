const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");

const app = express();
const logStreams = new Map();

async function writeWorkspaceLog(workspaceId, level, message, source = "system") {
  const result = await pool.query("INSERT INTO bot_logs (id, workspace_id, level, source, message) VALUES ($1,$2,$3,$4,$5) RETURNING id, level, source, message, created_at", [crypto.randomUUID(), workspaceId, level, source, String(message).slice(0, 2000)]);
  const entry = result.rows[0];
  for (const client of logStreams.get(workspaceId) || []) client.write("event: log\ndata: " + JSON.stringify(entry) + "\n\n");
  return entry;
}
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 365;

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required. Configure a persistent PostgreSQL database.");
if (isProduction && !process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is required in production.");
if (isProduction && !process.env.VAULT_ENCRYPTION_KEY) throw new Error("VAULT_ENCRYPTION_KEY is required in production.");
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

function vaultKey() {
  const raw = process.env.VAULT_ENCRYPTION_KEY || "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("VAULT_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return key;
}
function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", vaultKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

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
  await pool.query("CREATE TABLE IF NOT EXISTS bot_logs (id UUID PRIMARY KEY, workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, level VARCHAR(10) NOT NULL, source VARCHAR(30) NOT NULL DEFAULT 'system', message VARCHAR(2000) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE INDEX IF NOT EXISTS bot_logs_workspace_created_idx ON bot_logs(workspace_id, created_at DESC)");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_vault (
      profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      encrypted_password BYTEA NOT NULL,
      iv BYTEA NOT NULL,
      auth_tag BYTEA NOT NULL,
      register_format VARCHAR(10) NOT NULL DEFAULT 'auto',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS auth_vault_workspace_idx ON auth_vault(workspace_id)");
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
// The vault API deliberately returns metadata only. Passwords are encrypted at rest
// with AES-256-GCM and are never sent back to the browser after saving.
app.get("/api/vault/:profileId", async (req, res) => {
  const result = await pool.query(
    "SELECT register_format, updated_at FROM auth_vault WHERE workspace_id=$1 AND profile_id=$2",
    [req.session.workspaceId, req.params.profileId]
  );
  if (!result.rows[0]) return res.json({ configured: false, registerFormat: "auto" });
  res.json({ configured: true, registerFormat: result.rows[0].register_format, updatedAt: result.rows[0].updated_at });
});
app.put("/api/vault/:profileId", requireCsrf, async (req, res) => {
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const registerFormat = ["auto", "single", "double"].includes(req.body?.registerFormat) ? req.body.registerFormat : "auto";
  if (password.length < 1 || password.length > 128 || /[\\r\\n]/.test(password)) {
    return res.status(400).json({ error: "Password must be 1–128 characters and cannot contain line breaks." });
  }
  const profile = await pool.query("SELECT id FROM profiles WHERE workspace_id=$1 AND id=$2", [req.session.workspaceId, req.params.profileId]);
  if (!profile.rowCount) return res.status(404).json({ error: "Profile not found in this session." });
  let encrypted;
  try { encrypted = encryptSecret(password); }
  catch (error) { console.error("Vault encryption is not configured."); return res.status(503).json({ error: "Secure vault is not configured on the server yet." }); }
  await pool.query(
    `INSERT INTO auth_vault (profile_id,workspace_id,encrypted_password,iv,auth_tag,register_format,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     ON CONFLICT (profile_id) DO UPDATE SET encrypted_password=EXCLUDED.encrypted_password,iv=EXCLUDED.iv,auth_tag=EXCLUDED.auth_tag,register_format=EXCLUDED.register_format,updated_at=NOW()`,
    [req.params.profileId, req.session.workspaceId, encrypted.ciphertext, encrypted.iv, encrypted.tag, registerFormat]
  );
  res.json({ saved: true, configured: true, registerFormat });
});
app.delete("/api/vault/:profileId", requireCsrf, async (req, res) => {
  await pool.query("DELETE FROM auth_vault WHERE workspace_id=$1 AND profile_id=$2", [req.session.workspaceId, req.params.profileId]);
  res.json({ deleted: true, configured: false });
});

app.get("/api/logs", async (req, res) => {
  const level = ["INFO", "WARN", "ERROR", "DEBUG"].includes(req.query.level) ? req.query.level : null;
  const search = cleanText(req.query.q, 120) || null;
  const result = await pool.query("SELECT id, level, source, message, created_at FROM bot_logs WHERE workspace_id = $1 AND ($2::text IS NULL OR level = $2) AND ($3::text IS NULL OR message ILIKE $3 OR source ILIKE $3) ORDER BY created_at DESC LIMIT 200", [req.session.workspaceId, level, search ? "%" + search + "%" : null]);
  res.json({ logs: result.rows.reverse() });
});
app.get("/api/logs/stream", async (req, res) => {
  const workspaceId = req.session.workspaceId;
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders?.();
  const recent = await pool.query("SELECT id, level, source, message, created_at FROM bot_logs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 30", [workspaceId]);
  for (const entry of recent.rows.reverse()) res.write("event: log\ndata: " + JSON.stringify(entry) + "\n\n");
  if (!logStreams.has(workspaceId)) logStreams.set(workspaceId, new Set());
  logStreams.get(workspaceId).add(res);
  req.on("close", () => { const clients = logStreams.get(workspaceId); clients?.delete(res); if (clients?.size === 0) logStreams.delete(workspaceId); });
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

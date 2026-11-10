let csrfToken = "";
let profiles = [];
let selectedProfileId = null;
const $ = (id) => document.getElementById(id);

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.method && options.method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function showFeedback(message, isError = false) {
  $("feedback").textContent = message;
  $("feedback").style.color = isError ? "#ff9b9b" : "#bdb4ff";
}
function formValues() {
  return {
    name: $("profile-name").value,
    botName: $("bot-name").value,
    serverHost: $("server-host").value,
    serverPort: Number($("server-port").value),
    minecraftVersion: $("mc-version").value || "auto",
    thinkingLevel: $("thinking-level").value
  };
}
function fillForm(profile) {
  $("profile-name").value = profile.name;
  $("bot-name").value = profile.botName;
  $("server-host").value = profile.serverHost;
  $("server-port").value = profile.serverPort;
  if (!$("vault-server-host").value.trim()) $("vault-server-host").value = profile.serverHost;
  if (!$("vault-server-port").value.trim() || $("vault-server-port").value === "25565") $("vault-server-port").value = profile.serverPort;
  $("mc-version").value = profile.minecraftVersion;
  $("thinking-level").value = profile.thinkingLevel;
}
function renderProfiles() {
  const select = $("profile-select");
  select.replaceChildren();
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name + " — " + profile.serverHost;
    select.append(option);
  }
  if (selectedProfileId && profiles.some(p => p.id === selectedProfileId)) select.value = selectedProfileId;
  $("profile-count").textContent = String(profiles.length);
  $("delete-profile").disabled = profiles.length === 0;
  $("load-profile").disabled = profiles.length === 0;
}
function selectedProfile() { return profiles.find(p => p.id === $("profile-select").value); }
function currentBotName() { return $("bot-name").value.trim(); }
async function refreshVault() {
  const botName = currentBotName(); $("vault-bot-label").textContent = botName || "No bot selected";
  const list = $("vault-list"); list.replaceChildren();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(botName)) { $("vault-count").textContent = "Choose a valid bot name"; return; }
  try {
    const data = await api("/api/vault?botName=" + encodeURIComponent(botName));
    $("vault-count").textContent = data.entries.length + " SAVED SERVERS";
    if (!data.entries.length) { const p=document.createElement("p");p.className="muted";p.textContent="No server credentials saved for this bot yet.";list.append(p);return; }
    for (const entry of data.entries) {
      const row=document.createElement("div");row.className="vault-row";
      const host=document.createElement("span");host.textContent=entry.server_host;
      const port=document.createElement("span");port.textContent=String(entry.server_port);
      const masked=document.createElement("span");masked.className="vault-masked";masked.textContent="••••••••";
      const actions=document.createElement("div");actions.className="vault-actions";
      const copy=document.createElement("button");copy.className="button secondary";copy.type="button";copy.textContent="Copy";
      copy.addEventListener("click",async()=>{try{const data=await api("/api/vault/"+encodeURIComponent(entry.id)+"/reveal",{method:"POST",body:"{}"});await navigator.clipboard.writeText(data.password);showFeedback("Password copied for "+entry.server_host+".");}catch(e){showFeedback("Copy failed: "+e.message,true);}});
      const del=document.createElement("button");del.className="button danger";del.type="button";del.textContent="Delete";
      del.addEventListener("click",async()=>{if(!window.confirm("Delete credentials for "+entry.server_host+" under "+botName+"?"))return;try{await api("/api/vault/"+encodeURIComponent(entry.id),{method:"DELETE",body:"{}"});await refreshVault();}catch(e){showFeedback(e.message,true);}});
      actions.append(copy,del);row.append(host,port,masked,actions);list.append(row);
    }
  } catch(e) { $("vault-count").textContent="Could not load"; showFeedback("Vault could not load: "+e.message,true); }
}
async function saveVaultEntry() {
  const button = $("vault-save"), botName = currentBotName();
  const serverHost = $("vault-server-host").value.trim() || $("server-host").value.trim();
  const serverPort = Number($("vault-server-port").value || $("server-port").value || 25565);
  const password = $("vault-password").value;
  if (!/^[A-Za-z0-9_]{3,16}$/.test(botName)) return showFeedback("Bot name must be 3–16 letters, numbers, or underscores.", true);
  if (!serverHost) return showFeedback("Enter a server address in Server settings or the vault form.", true);
  if (!password) return showFeedback("Enter the server password first.", true);
  button.disabled = true; button.textContent = "Saving securely…";
  try {
    await api("/api/vault",{method:"POST",body:JSON.stringify({botName,serverHost,serverPort,password})});
    $("vault-password").value=""; $("vault-server-host").value=serverHost; $("vault-server-port").value=String(serverPort);
    showFeedback("✓ Password securely saved for "+botName+" on "+serverHost+":"+serverPort+".");
    await refreshVault();
  } catch(e) { showFeedback("Save failed: "+e.message,true); }
  finally { button.disabled=false; button.textContent="Save password"; }
}
async function loadProfile() {
  const profile = selectedProfile();
  if (!profile) return;
  try {
    const data = await api("/api/profiles/" + encodeURIComponent(profile.id) + "/load", { method: "POST", body: "{}" });
    selectedProfileId = data.profile.id;
    fillForm(data.profile);
    renderProfiles();
    showFeedback(data.message);
  } catch (error) { showFeedback(error.message, true); }
}
async function saveProfile() {
  try {
    const data = await api("/api/profiles", { method: "POST", body: JSON.stringify(formValues()) });
    profiles = data.profiles;
    selectedProfileId = data.profile.id;
    renderProfiles();
    fillForm(data.profile);
    showFeedback("Profile saved in this browser session.");
  } catch (error) { showFeedback(error.message, true); }
}
async function deleteProfile() {
  const profile = selectedProfile();
  if (!profile || !window.confirm("Delete the profile “" + profile.name + "” from this session?")) return;
  try {
    const data = await api("/api/profiles/" + encodeURIComponent(profile.id), { method: "DELETE" });
    profiles = data.profiles;
    selectedProfileId = data.selectedProfileId;
    renderProfiles();
    if (profiles.length) fillForm(profiles.find(p => p.id === selectedProfileId) || profiles[0]);
    showFeedback("Profile deleted.");
  } catch (error) { showFeedback(error.message, true); }
}
async function exportProfiles() {
  try {
    const data = await api("/api/profiles/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pvpbotai-profiles.json";
    link.click();
    URL.revokeObjectURL(url);
    showFeedback("Profile export downloaded. It contains no API keys.");
  } catch (error) { showFeedback(error.message, true); }
}
const seenLogIds = new Set();
function logTime(value) { return new Date(value).toLocaleTimeString(); }
function appendConsoleEntry(entry) {
  if (seenLogIds.has(entry.id)) return;
  seenLogIds.add(entry.id);
  const line = document.createElement("div");
  line.className = "terminal-line";
  const time = document.createElement("span"); time.className = "log-time"; time.textContent = logTime(entry.created_at);
  const level = document.createElement("span"); level.className = "level level-" + entry.level.toLowerCase(); level.textContent = entry.level;
  const source = document.createElement("span"); source.className = "log-source"; source.textContent = "[" + entry.source + "]";
  const message = document.createElement("span"); message.className = "log-message"; message.textContent = entry.message;
  line.append(time, level, source, message);
  const output = $("console-output"); output.append(line);
  while (output.children.length > 150) output.firstElementChild.remove();
  output.scrollTop = output.scrollHeight;
  $("logs-count").textContent = seenLogIds.size + " EVENTS";
}
async function refreshLogs() {
  try {
    const params = new URLSearchParams();
    if ($("logs-level").value) params.set("level", $("logs-level").value);
    if ($("logs-search").value.trim()) params.set("q", $("logs-search").value.trim());
    const data = await api("/api/logs?" + params.toString());
    const list = $("logs-list"); list.replaceChildren();
    $("logs-count").textContent = data.logs.length + " MATCHING";
    if (!data.logs.length) { const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "No matching log entries."; list.append(empty); return; }
    for (const entry of data.logs) {
      const row = document.createElement("div"); row.className = "log-row";
      const time = document.createElement("time"); time.className = "log-time"; time.textContent = new Date(entry.created_at).toLocaleString();
      const level = document.createElement("span"); level.className = "level level-" + entry.level.toLowerCase(); level.textContent = entry.level;
      const source = document.createElement("span"); source.className = "log-source"; source.textContent = entry.source;
      const message = document.createElement("span"); message.className = "log-message"; message.textContent = entry.message;
      row.append(time, level, source, message); list.append(row);
      appendConsoleEntry(entry);
    }
  } catch (error) { showFeedback("Could not load logs: " + error.message, true); }
}
function connectLogStream() {
  const stream = new EventSource("/api/logs/stream");
  stream.addEventListener("open", () => { $("console-connection").textContent = "STREAM LIVE"; });
  stream.addEventListener("log", event => { try { appendConsoleEntry(JSON.parse(event.data)); } catch {} });
  stream.addEventListener("error", () => { $("console-connection").textContent = "RECONNECTING"; });
  $("clear-console").addEventListener("click", () => { $("console-output").replaceChildren(); seenLogIds.clear(); });
  $("refresh-logs").addEventListener("click", refreshLogs);
  $("logs-level").addEventListener("change", refreshLogs);
  $("logs-search").addEventListener("input", refreshLogs);
}
async function refreshBotState() {
  try {
    const state = await api("/api/state");
    $("bot-status").textContent = state.botStatus;
    $("runtime-status").textContent = state.connected ? "Connected to " + state.serverHost + ":" + state.serverPort : "Bot is " + state.botStatus + ".";
    $("connect-bot").disabled = state.connected;
    $("disconnect-bot").disabled = !state.connected;
    updateConnectionDiagnostic(state);
  } catch {}
}
async function connectBot() {
  const profile = selectedProfile();
  if (!profile) return showFeedback("Select a saved profile first.", true);
  try {
    const result = await api("/api/bot/connect", { method:"POST", body:JSON.stringify({profileId:profile.id}) });
    showFeedback(result.message);
    await refreshBotState();
    await refreshLogs();
  } catch(error) { showFeedback(error.message,true); }
}
async function disconnectBot() {
  try {
    await api("/api/bot/disconnect", { method:"POST", body:"{}" });
    showFeedback("Bot disconnected.");
    await refreshBotState();
  } catch(error) { showFeedback(error.message,true); }
}

function enhanceGlassSelects() {
  document.querySelectorAll("select").forEach((select, index) => {
    if (select.dataset.glassReady) return;
    select.dataset.glassReady = "1";
    select.classList.add("glass-native");
    const wrap = document.createElement("div");
    wrap.className = "glass-select";
    const trigger = document.createElement("button");
    trigger.type = "button"; trigger.className = "glass-select-trigger";
    trigger.setAttribute("aria-haspopup","listbox");
    trigger.setAttribute("aria-expanded","false");
    trigger.setAttribute("aria-label",select.getAttribute("aria-label") || select.closest("label")?.childNodes[0]?.textContent?.trim() || "Choose an option");
    const label = document.createElement("span");
    trigger.append(label);
    const menu = document.createElement("div");
    menu.className = "glass-select-menu"; menu.setAttribute("role","listbox");
    menu.id = "glass-select-menu-" + index;
    trigger.setAttribute("aria-controls",menu.id);
    function sync() {
      const option = select.options[select.selectedIndex];
      label.textContent = option ? option.textContent : "Choose…";
      menu.querySelectorAll(".glass-option").forEach(button => {
        const active = button.dataset.value === select.value;
        button.setAttribute("aria-selected",String(active));
      });
      trigger.disabled = select.disabled;
    }
    Array.from(select.options).forEach(option => {
      const item = document.createElement("button");
      item.type = "button"; item.className = "glass-option";
      item.textContent = option.textContent; item.dataset.value = option.value;
      item.setAttribute("role","option");
      item.addEventListener("click",() => {
        select.value = option.value;
        select.dispatchEvent(new Event("change",{bubbles:true}));
        sync(); wrap.classList.remove("open"); trigger.setAttribute("aria-expanded","false");
        trigger.focus();
      });
      menu.append(item);
    });
    trigger.addEventListener("click",() => {
      const open = !wrap.classList.contains("open");
      document.querySelectorAll(".glass-select.open").forEach(node => {
        node.classList.remove("open"); node.querySelector(".glass-select-trigger")?.setAttribute("aria-expanded","false");
      });
      if (open) { wrap.classList.add("open"); trigger.setAttribute("aria-expanded","true"); }
    });
    trigger.addEventListener("keydown",event => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); wrap.classList.add("open"); trigger.setAttribute("aria-expanded","true");
        const options = [...menu.querySelectorAll(".glass-option")];
        (options[select.selectedIndex] || options[0])?.focus();
      }
    });
    menu.addEventListener("keydown",event => {
      const options = [...menu.querySelectorAll(".glass-option")];
      const current = options.indexOf(document.activeElement);
      if (event.key === "Escape") { wrap.classList.remove("open");trigger.setAttribute("aria-expanded","false");trigger.focus(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); options[(current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus(); }
    });
    select.addEventListener("change",sync);
    select.insertAdjacentElement("afterend",wrap);
    wrap.append(trigger,menu); sync();
  });
  document.addEventListener("click",event => {
    if (!event.target.closest(".glass-select")) document.querySelectorAll(".glass-select.open").forEach(node => {
      node.classList.remove("open"); node.querySelector(".glass-select-trigger")?.setAttribute("aria-expanded","false");
    });
  });
}
function updateConnectionDiagnostic(state) {
  const panel = $("connection-diagnostic");
  if (!panel) return;
  const status = state.botStatus || "disconnected";
  panel.dataset.state = status === "failed" ? "failed" : (state.connected ? (status === "connecting" ? "connecting" : "connected") : "idle");
  const title = $("diagnostic-title"), message = $("diagnostic-message");
  if (status === "connecting") { title.textContent = "Connecting to Minecraft…"; message.textContent = "Waiting for the server handshake. This can take up to 45 seconds."; }
  else if (status === "connected" || status === "authenticated") { title.textContent = status === "authenticated" ? "Server authentication complete" : "Connected to server"; message.textContent = "The bot has joined the Minecraft world."; }
  else if (status === "failed") { title.textContent = "Connection failed"; message.textContent = state.lastError || "The server ended the connection. Check the live console for details."; }
  else { title.textContent = "Ready to connect"; message.textContent = "Connection diagnostics will appear here after you connect."; }
}

async function init() {
  try {
    const data = await api("/api/bootstrap");
    csrfToken = data.csrfToken;
    enhanceGlassSelects();
    profiles = data.profiles;
    selectedProfileId = data.selectedProfileId;
    $("bot-status").textContent = data.botStatus === "disconnected" ? "Disconnected" : data.botStatus;
    renderProfiles();
    const active = profiles.find(p => p.id === selectedProfileId) || profiles[0];
    if (active) fillForm(active);
    $("profile-select").addEventListener("change", async () => {
      const profile = selectedProfile();
      if (profile) { fillForm(profile); $("vault-server-host").value=profile.serverHost; $("vault-server-port").value=String(profile.serverPort); }
      await refreshVault();
    });
    $("bot-name").addEventListener("change", refreshVault);
    $("vault-save").addEventListener("click", saveVaultEntry);
    $("vault-refresh").addEventListener("click", refreshVault);
    $("connect-bot").addEventListener("click", connectBot);
    $("disconnect-bot").addEventListener("click", disconnectBot);
    $("load-profile").addEventListener("click", loadProfile);
    $("save-profile").addEventListener("click", saveProfile);
    $("delete-profile").addEventListener("click", deleteProfile);
    $("export-profiles").addEventListener("click", exportProfiles);
    $("vault-server-host").value = active?.serverHost || "";
    $("vault-server-port").value = String(active?.serverPort || 25565);
    connectLogStream();
    await refreshVault();
    await refreshBotState();
    setInterval(refreshBotState, 5000);
    await refreshLogs();
  } catch (error) { showFeedback(error.message, true); }
}
init();
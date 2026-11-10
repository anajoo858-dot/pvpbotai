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
async function init() {
  try {
    const data = await api("/api/bootstrap");
    csrfToken = data.csrfToken;
    profiles = data.profiles;
    selectedProfileId = data.selectedProfileId;
    $("bot-status").textContent = data.botStatus === "disconnected" ? "Disconnected" : data.botStatus;
    renderProfiles();
    const active = profiles.find(p => p.id === selectedProfileId) || profiles[0];
    if (active) fillForm(active);
    $("profile-select").addEventListener("change", () => {
      const profile = selectedProfile();
      if (profile) fillForm(profile);
    });
    $("load-profile").addEventListener("click", loadProfile);
    $("save-profile").addEventListener("click", saveProfile);
    $("delete-profile").addEventListener("click", deleteProfile);
    $("export-profiles").addEventListener("click", exportProfiles);
    connectLogStream();
    await refreshLogs();
  } catch (error) { showFeedback(error.message, true); }
}
init();
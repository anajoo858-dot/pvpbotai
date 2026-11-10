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
  } catch (error) { showFeedback(error.message, true); }
}
init();
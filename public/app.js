let csrfToken = "";
let currentProfile = null;
const $ = (id) => document.getElementById(id);
async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.method && options.method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function showFeedback(message, isError = false) {
  $("feedback").textContent = message;
  $("feedback").style.color = isError ? "#ff9b9b" : "#bdb4ff";
}
function displayProfile(profile) {
  currentProfile = profile;
  $("profile-name").textContent = profile.name;
  $("profile-meta").textContent = profile.serverHost + ":" + profile.serverPort + " · " + profile.botName;
  $("bot-name").value = profile.botName;
  $("server-host").value = profile.serverHost;
  $("server-port").value = profile.serverPort;
  $("mc-version").value = profile.minecraftVersion;
  $("thinking-level").value = profile.thinkingLevel;
}
async function init() {
  try {
    const data = await api("/api/bootstrap");
    csrfToken = data.csrfToken;
    $("profile-count").textContent = data.profiles.length;
    $("bot-status").textContent = data.botStatus === "disconnected" ? "Disconnected" : data.botStatus;
    const profile = data.profiles.find(item => item.id === data.selectedProfileId) || data.profiles[0];
    if (profile) displayProfile(profile);
    $("load-profile").addEventListener("click", loadSelectedProfile);
  } catch (error) { showFeedback(error.message, true); }
}
async function loadSelectedProfile() {
  if (!currentProfile) return;
  const button = $("load-profile");
  button.disabled = true;
  button.textContent = "Loading…";
  try {
    const data = await api("/api/profiles/" + encodeURIComponent(currentProfile.id) + "/load", { method: "POST", body: "{}" });
    displayProfile(data.profile);
    showFeedback(data.message);
  } catch (error) { showFeedback(error.message, true); }
  finally { button.disabled = false; button.textContent = "Load profile"; }
}
init();
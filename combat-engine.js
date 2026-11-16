"use strict";

/**
 * PvPBotAI shared combat decision core.
 * Produces loadout-aware practice guidance; it does not issue attacks or select targets.
 */
const MODE_LABELS = {
  general: "General Combat", smp: "SMP", cpvp: "Crystal PvP",
  sword: "Sword PvP", axe: "Axe PvP", uhc: "UHC", pot: "Pot PvP"
};

function buildCombatPlan({ mode = "general", fightingStyle = "balanced", health = 20, food = 20, inventory = [], equipment = [] } = {}) {
  const counts = new Map();
  for (const item of inventory) {
    const name = String(item?.name || "").toLowerCase();
    if (name) counts.set(name, (counts.get(name) || 0) + Math.max(0, Number(item.count) || 0));
  }
  const has = (...terms) => [...counts.keys()].some(name => terms.some(term => name.includes(term)));
  const recommendations = [];
  const hp = Number.isFinite(Number(health)) ? Number(health) : 20;
  const hunger = Number.isFinite(Number(food)) ? Number(food) : 20;
  if (hp <= 8) recommendations.push("High priority: disengage from the practice exchange and restore health before re-engaging.");
  else if (hp <= 14) recommendations.push("Keep a defensive distance and check healing supplies before continuing.");
  else recommendations.push("Health is stable; maintain awareness of positioning and incoming damage.");
  if (hunger <= 8) recommendations.push("Restore hunger so natural regeneration remains available.");
  if (has("golden_apple", "enchanted_golden_apple")) recommendations.push("Golden apples detected: reserve them for a planned recovery window.");
  if (has("potion")) recommendations.push("Potions detected: review their effects and keep useful recovery or utility options accessible.");
  if (has("shield")) recommendations.push("Shield detected: use it as a defensive option when the selected mode permits.");
  if (has("totem")) recommendations.push("Totem detected: confirm the offhand slot is configured as intended.");
  if (has("ender_pearl")) recommendations.push("Ender pearls detected: keep an escape/reposition option available.");
  if (has("obsidian", "end_crystal", "respawn_anchor")) recommendations.push("Explosive/CPvP-related items detected: this loadout contains CPvP utility; use only in a rules-approved CPvP arena.");
  if (has("sword")) recommendations.push("Sword detected: suitable as the primary weapon in sword-oriented modes.");
  if (has("axe")) recommendations.push("Axe detected: suitable for axe-oriented play; check cooldown timing.");
  if (has("bow", "crossbow", "arrow")) recommendations.push("Ranged equipment detected: consider line of sight and available ammunition.");
  if (!recommendations.length || recommendations.length < 3) recommendations.push("No specialized combat items were recognized; inspect the inventory and adapt the hotbar manually.");
  if (fightingStyle === "defensive") recommendations.push("Style: Defensive — prioritize recovery, spacing, and preserving resources.");
  else if (fightingStyle === "aggressive") recommendations.push("Style: Aggressive — choose deliberate openings, but do not trade away safety at low health.");
  else if (fightingStyle === "tactical") recommendations.push("Style: Tactical — adapt item choice and positioning to the current mode.");
  else if (fightingStyle === "adaptive") recommendations.push("Style: Adaptive — change priorities as health, hunger, and available items change.");
  else recommendations.push("Style: Balanced — keep offense, defense, and resource use in balance.");
  const modeLabel = MODE_LABELS[mode] || MODE_LABELS.general;
  return {
    mode,
    modeLabel,
    fightingStyle,
    summary: modeLabel + " loadout analysis: " + counts.size + " recognized item types; " + Math.round(hp) + "/20 health and " + Math.round(hunger) + "/20 hunger.",
    recommendations: recommendations.slice(0, 8),
    inventoryTypes: [...counts.keys()].sort(),
    equipment: equipment.map(String).slice(0, 4)
  };
}

module.exports = { buildCombatPlan };

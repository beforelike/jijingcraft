const { MELEE_HOSTILE_MOBS } = require("./constants");

function armedMeleeDefenseDistance(immediateThreatRadius = 8) {
  return Math.max(4.5, Math.min(immediateThreatRadius, immediateThreatRadius * 0.85));
}

function chooseHostileDamageResponse({ health, criticalHealth, distance = Infinity, immediateThreatRadius = 8, hasWeapon = false, targetName = null }) {
  if (health <= criticalHealth) return "retreat";
  const meleeThreat = targetName ? MELEE_HOSTILE_MOBS.has(targetName) : true;
  if (hasWeapon && meleeThreat && distance <= armedMeleeDefenseDistance(immediateThreatRadius)) return "defend";
  return "retreat";
}

module.exports = {
  armedMeleeDefenseDistance,
  chooseHostileDamageResponse
};
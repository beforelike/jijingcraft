function chooseHostileDamageResponse({ health, criticalHealth, distance = Infinity, immediateThreatRadius = 8, hasWeapon = false }) {
  if (health <= criticalHealth) return "retreat";
  const closeCombatDistance = Math.max(3.2, Math.min(4.5, immediateThreatRadius * 0.55));
  if (hasWeapon && distance <= closeCombatDistance) return "defend";
  return "retreat";
}

module.exports = {
  chooseHostileDamageResponse
};
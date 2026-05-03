function chooseHostileDamageResponse({ health, criticalHealth }) {
  if (health <= criticalHealth) return "retreat";
  return "retreat";
}

module.exports = {
  chooseHostileDamageResponse
};
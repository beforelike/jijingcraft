function computeReconnectDelay(reconnectConfig, attempt) {
  const minDelayMs = Math.max(0, reconnectConfig?.minDelayMs ?? 5000);
  const maxDelayMs = Math.max(minDelayMs, reconnectConfig?.maxDelayMs ?? minDelayMs);
  const exponent = Math.max(0, attempt - 1);
  return Math.min(maxDelayMs, minDelayMs * 2 ** exponent);
}

module.exports = { computeReconnectDelay };
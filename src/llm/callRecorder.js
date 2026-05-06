const fs = require("node:fs");
const path = require("node:path");

function nowIso() {
  return new Date().toISOString();
}

function baseHostFromUrl(baseUrl) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
}

function truncate(value, maxLength = 800) {
  if (value === null || value === undefined) return value;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function sanitizeRecord(record = {}) {
  const sanitized = {
    timestamp: record.timestamp ?? nowIso(),
    type: record.type ?? "unknown",
    status: record.status ?? "unknown",
    model: record.model ?? null,
    baseHost: record.baseHost ?? baseHostFromUrl(record.baseUrl),
    durationMs: Number.isFinite(record.durationMs) ? record.durationMs : null,
    usage: record.usage ?? null,
    promptSummary: truncate(record.promptSummary ?? null, 1000),
    responseSummary: truncate(record.responseSummary ?? null, 1000),
    toolCalls: Array.isArray(record.toolCalls) ? record.toolCalls.map((toolCall) => ({
      id: toolCall.id ?? null,
      name: toolCall.name ?? null,
      arguments: truncate(toolCall.arguments ?? null, 500)
    })) : [],
    toolResults: Array.isArray(record.toolResults) ? record.toolResults.map((toolResult) => ({
      id: toolResult.id ?? null,
      name: toolResult.name ?? null,
      result: truncate(toolResult.result ?? null, 800)
    })) : [],
    plan: record.plan ?? null,
    error: record.error ? truncate(record.error, 800) : null
  };
  return sanitized;
}

class LlmCallRecorder {
  constructor(options = {}) {
    this.recordsDir = options.recordsDir ?? path.resolve("data", "llm", "records");
    this.maxRecentCalls = options.maxRecentCalls ?? 20;
    this.recentCalls = [];
  }

  record(record) {
    const sanitized = sanitizeRecord(record);
    this.recentCalls.unshift(sanitized);
    this.recentCalls = this.recentCalls.slice(0, this.maxRecentCalls);
    fs.mkdirSync(this.recordsDir, { recursive: true });
    const filePath = path.join(this.recordsDir, `${sanitized.timestamp.slice(0, 10)}.jsonl`);
    fs.appendFileSync(filePath, `${JSON.stringify(sanitized)}\n`, "utf8");
    return sanitized;
  }

  listRecent() {
    return this.recentCalls.map((record) => ({ ...record }));
  }
}

module.exports = {
  LlmCallRecorder,
  baseHostFromUrl,
  sanitizeRecord
};
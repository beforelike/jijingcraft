#!/usr/bin/env node
const path = require("node:path");
const {
  DEFAULT_OUTPUT_ROOT,
  DEFAULT_WIKI_API_URL,
  DEFAULT_WIKI_PAGES,
  ingestMinecraftWiki
} = require("../src/knowledge/minecraftWikiIngest");

function parseArgs(argv) {
  const args = {
    apiUrl: DEFAULT_WIKI_API_URL,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    pages: DEFAULT_WIKI_PAGES,
    delayMs: 500
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--api" && next) {
      args.apiUrl = next;
      index += 1;
    } else if (arg === "--output" && next) {
      args.outputRoot = path.resolve(next);
      index += 1;
    } else if (arg === "--pages" && next) {
      args.pages = next.split(",").map((page) => page.trim()).filter(Boolean);
      index += 1;
    } else if (arg === "--delay-ms" && next) {
      args.delayMs = Number(next);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: npm run ingest:minecraft-wiki -- [options]\n\nOptions:\n  --pages "Sand,Gravel"       Comma-separated Minecraft Wiki page titles.\n  --output <dir>              Output directory for raw pages, manifest, and JSONL corpus.\n  --api <url>                 MediaWiki API endpoint. Defaults to ${DEFAULT_WIKI_API_URL}.\n  --delay-ms <ms>             Delay between page requests. Defaults to 500.\n`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const result = await ingestMinecraftWiki(args);
  console.log(`ingested ${result.rawPages.length} wiki pages into ${result.documents.length} RAG chunks`);
  console.log(`corpus: ${result.corpusPath}`);
  console.log(`manifest: ${result.manifestPath}`);
  if (result.failures.length) {
    console.log(`failed pages: ${result.failures.map((failure) => `${failure.title}: ${failure.error}`).join("; ")}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

module.exports = {
  parseArgs
};
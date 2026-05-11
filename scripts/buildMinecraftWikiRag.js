#!/usr/bin/env node
const path = require("node:path");
const { DEFAULT_OUTPUT_ROOT, buildWikiCorpusFromLocalPages } = require("../src/knowledge/minecraftWikiIngest");

function parseArgs(argv) {
  const args = { outputRoot: DEFAULT_OUTPUT_ROOT };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--output" && next) {
      args.outputRoot = path.resolve(next);
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
  console.log("Usage: npm run build:minecraft-wiki-rag -- [--output <dir>]\n\nReads editable data/knowledge/wiki/pages/*.md and regenerates minecraft-wiki-rag.jsonl plus chunk previews.");
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  const result = buildWikiCorpusFromLocalPages(args);
  console.log(`built ${result.documents.length} RAG chunks from ${result.pages.length} local wiki markdown pages`);
  console.log(`corpus: ${result.corpusPath}`);
  console.log(`chunks: ${result.chunkDir}`);
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}

module.exports = { parseArgs };
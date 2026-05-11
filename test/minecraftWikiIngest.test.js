const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildMinecraftRagCorpus } = require("../src/knowledge/minecraftKnowledgeBase");
const { DEFAULT_WIKI_PAGES, buildWikiCorpusFromLocalPages, ingestMinecraftWiki, pageToDocuments, paragraphsFromExtract, slugify } = require("../src/knowledge/minecraftWikiIngest");

const sandExtract = `Sand is a gravity-affected block found in beaches and deserts.

When sand has no supporting block below it, it falls as a falling block entity until it lands on another block. Removing support can therefore open a column and make the sand drop into that space.

Mining near sand requires care because falling blocks can occupy the player collision space and cause suffocation damage.

History

Sand was added in an early version.`;

function fakeWikiResponse(title, extract = sandExtract) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      query: {
        pages: [{
          pageid: 12,
          title,
          fullurl: `https://minecraft.wiki/w/${encodeURIComponent(title).replace(/%20/g, "_")}`,
          extract,
          revisions: [{ revid: 99, timestamp: "2026-05-01T00:00:00Z", sha1: "abc" }]
        }]
      }
    })
  };
}

test("wiki ingestion parses useful paragraphs and drops low-value sections", () => {
  const paragraphs = paragraphsFromExtract(sandExtract);

  assert.ok(paragraphs.some((paragraph) => /gravity-affected/.test(paragraph)));
  assert.equal(paragraphs.some((paragraph) => /^Sand was added/.test(paragraph)), false);

  const documents = pageToDocuments({
    title: "Sand",
    fullurl: "https://minecraft.wiki/w/Sand",
    revisionId: 99,
    revisionTimestamp: "2026-05-01T00:00:00Z",
    retrievedAt: "2026-05-11T00:00:00Z",
    extract: sandExtract,
    extractHash: "hash"
  }, { chunking: { minChars: 120, maxChars: 500 } });

  assert.ok(documents.length >= 1);
  assert.equal(documents[0].source, "minecraft_wiki_local_crawl");
  assert.equal(documents[0].sourceTitle, "Sand");
  assert.ok(documents[0].tags.includes("falling_blocks"));
  assert.ok(documents[0].rules.some((rule) => /support/.test(rule)));
  assert.equal(slugify("Tutorial:Beginner's guide"), "tutorial__beginners-guide");
});

test("ingestMinecraftWiki stores raw pages, manifest, and local RAG chunks", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-wiki-ingest-"));
  const result = await ingestMinecraftWiki({
    pages: ["Sand"],
    outputRoot: tempDir,
    delayMs: 0,
    now: () => "2026-05-11T00:00:00Z",
    fetchImpl: async () => fakeWikiResponse("Sand")
  });

  assert.equal(result.rawPages.length, 1);
  assert.equal(result.failures.length, 0);
  assert.ok(fs.existsSync(path.join(tempDir, "raw", "sand.json")));
  assert.ok(fs.existsSync(path.join(tempDir, "pages", "sand.md")));
  assert.ok(fs.existsSync(path.join(tempDir, "chunks")));
  assert.ok(fs.existsSync(path.join(tempDir, "manifest.json")));
  assert.ok(fs.existsSync(path.join(tempDir, "minecraft-wiki-rag.jsonl")));

  const manifest = JSON.parse(fs.readFileSync(path.join(tempDir, "manifest.json"), "utf8"));
  assert.equal(manifest.source, "minecraft_wiki_local_crawl");
  assert.equal(manifest.documentCount, result.documents.length);
  assert.equal(manifest.qualityControls.rawExtractsStored, true);
  assert.equal(manifest.qualityControls.editableMarkdownSource, true);

  const pageMarkdown = fs.readFileSync(path.join(tempDir, "pages", "sand.md"), "utf8");
  assert.match(pageMarkdown, /## Local Wiki Text/);
  assert.match(pageMarkdown, /supporting block below/);

  const lines = fs.readFileSync(path.join(tempDir, "minecraft-wiki-rag.jsonl"), "utf8").trim().split(/\r?\n/);
  const first = JSON.parse(lines[0]);
  assert.match(first.content, /supporting block below/);
  assert.equal(first.revisionId, 99);

  const merged = buildMinecraftRagCorpus({ wikiCorpusPath: path.join(tempDir, "minecraft-wiki-rag.jsonl") });
  assert.ok(merged.some((entry) => entry.source === "minecraft_wiki_local_crawl" && /supporting block below/.test(entry.content)));
});

test("local wiki markdown edits rebuild into the RAG corpus", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-wiki-editable-"));
  await ingestMinecraftWiki({
    pages: ["Sand"],
    outputRoot: tempDir,
    delayMs: 0,
    now: () => "2026-05-11T00:00:00Z",
    fetchImpl: async () => fakeWikiResponse("Sand")
  });

  const pagePath = path.join(tempDir, "pages", "sand.md");
  const edited = fs.readFileSync(pagePath, "utf8").replace(
    "supporting block below it",
    "supporting block below it. LOCAL_REVIEW_NOTE: audit edits are used by RAG"
  );
  fs.writeFileSync(pagePath, edited, "utf8");

  const rebuilt = buildWikiCorpusFromLocalPages({
    outputRoot: tempDir,
    now: () => "2026-05-11T01:00:00Z",
    chunking: { minChars: 120, maxChars: 500 }
  });

  assert.equal(rebuilt.manifest.source, "minecraft_wiki_local_markdown");
  assert.equal(rebuilt.manifest.qualityControls.jsonlGeneratedFromLocalMarkdown, true);
  assert.ok(rebuilt.documents.some((document) => /LOCAL_REVIEW_NOTE/.test(document.content)));

  const corpusText = fs.readFileSync(path.join(tempDir, "minecraft-wiki-rag.jsonl"), "utf8");
  assert.match(corpusText, /LOCAL_REVIEW_NOTE/);
});

test("default wiki page allowlist covers core survival knowledge breadth", () => {
  for (const title of ["Hunger", "Food", "Cow", "Pig", "Chicken", "Sheep", "Nether portal", "Obsidian", "Lava", "Water", "Torch", "Bed"]) {
    assert.ok(DEFAULT_WIKI_PAGES.includes(title), `${title} should be in default wiki pages`);
  }
});
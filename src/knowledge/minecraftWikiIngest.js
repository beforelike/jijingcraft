const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_WIKI_API_URL = "https://minecraft.wiki/api.php";
const DEFAULT_OUTPUT_ROOT = path.resolve(__dirname, "..", "..", "data", "knowledge", "wiki");
const DEFAULT_WIKI_CORPUS_FILE = "minecraft-wiki-rag.jsonl";
const DEFAULT_RAW_DIR = "raw";
const DEFAULT_PAGE_DIR = "pages";
const DEFAULT_CHUNK_DIR = "chunks";
const DEFAULT_MANIFEST_FILE = "manifest.json";

const DEFAULT_WIKI_PAGES = Object.freeze([
  "Sand",
  "Gravel",
  "Concrete Powder",
  "Falling Block",
  "Suffocation",
  "Damage",
  "Hunger",
  "Food",
  "Cow",
  "Pig",
  "Chicken",
  "Sheep",
  "Cod",
  "Salmon",
  "Nether portal",
  "Obsidian",
  "Flint and Steel",
  "Lava",
  "Water",
  "Torch",
  "Bed",
  "Door",
  "Crafting Table",
  "Pickaxe",
  "Axe",
  "Sword",
  "Shovel",
  "Tutorial:Mining",
  "Tutorial:Beginner's guide"
]);

const LICENSE = Object.freeze({
  name: "Minecraft Wiki content license",
  notice: "Minecraft Wiki text is stored locally for retrieval with source attribution. Check the wiki copyright page for current terms before redistribution.",
  url: "https://minecraft.wiki/w/Minecraft_Wiki:Copyrights"
});

const EXCLUDED_SECTION_TITLES = new Set([
  "achievements",
  "advancements",
  "data values",
  "external links",
  "gallery",
  "history",
  "issues",
  "notes",
  "references",
  "sounds",
  "trivia",
  "video",
  "videos"
]);

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/[:]+/g, "__") || "page";
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\r/g, "\n")
    .replace(/\[[0-9]+\]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isLikelySectionTitle(paragraph) {
  const text = paragraph.trim();
  if (!text || text.length > 60 || /[.!?。！？]$/.test(text)) return false;
  return /^[A-Z0-9][A-Za-z0-9 ':()\/-]+$/.test(text);
}

function shouldDropParagraph(paragraph) {
  const text = paragraph.trim();
  if (text.length < 40) return true;
  const lower = text.toLowerCase();
  if (EXCLUDED_SECTION_TITLES.has(lower)) return true;
  if (/^this section is missing information/i.test(text)) return true;
  if (/^see also$/i.test(text)) return true;
  if (/^references?$/i.test(text)) return true;
  return false;
}

function paragraphsFromExtract(extract) {
  const lines = normalizeWhitespace(extract).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const paragraphs = [];
  let droppingLowValueSection = false;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (isLikelySectionTitle(line)) {
      droppingLowValueSection = EXCLUDED_SECTION_TITLES.has(lower);
      if (droppingLowValueSection) continue;
    }
    if (droppingLowValueSection) continue;
    if (!shouldDropParagraph(line)) paragraphs.push(line);
  }

  return paragraphs;
}

function chunkParagraphs(paragraphs, options = {}) {
  const minChars = options.minChars ?? 280;
  const maxChars = options.maxChars ?? 1100;
  const chunks = [];
  let buffer = "";

  for (const paragraph of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChars && buffer.length >= minChars) {
      chunks.push(buffer);
      buffer = paragraph;
    } else {
      buffer = candidate;
    }
  }

  if (buffer.length >= Math.min(minChars, 120)) chunks.push(buffer);
  return chunks;
}

function inferTags(title, content) {
  const haystack = `${title} ${content}`.toLowerCase();
  const tags = new Set(["minecraft_wiki"]);
  const tagRules = [
    [/\b(sand|gravel|concrete powder|falling block)\b/, ["falling_blocks", "gravity", "support"]],
    [/\b(suffocat\w*|inside a block|collision)\b/, ["suffocation", "damage", "burial"]],
    [/\b(damage|health|armor|difficulty|regeneration)\b/, ["damage", "health", "difficulty"]],
    [/\b(mine|mining|stone|ore|cave|stair|staircase)\b/, ["mining", "collect_stone", "stone"]],
    [/\b(beginner|wood|log|crafting table|pickaxe|shelter|food)\b/, ["survival_progression", "starter_tasks"]],
    [/\b(hunger|food|eat|eating|saturation|cow|pig|chicken|sheep|cod|salmon|beef|porkchop|mutton)\b/, ["food", "hunger", "mobs"]],
    [/\b(nether portal|obsidian|flint and steel)\b/, ["nether", "portal", "obsidian"]],
    [/\b(lava|water|drown|drowning|swim|bucket)\b/, ["fluids", "hazard", "water", "lava"]],
    [/\b(torch|light|spawn|bed|sleep|door)\b/, ["shelter", "night_safety", "utility_blocks"]],
    [/\b(pickaxe|axe|sword|shovel|tool|tools)\b/, ["tools", "crafting"]]
  ];

  for (const [pattern, values] of tagRules) {
    if (pattern.test(haystack)) values.forEach((tag) => tags.add(tag));
  }
  return [...tags].sort();
}

function inferTopic(title, content) {
  const tags = inferTags(title, content);
  if (tags.includes("falling_blocks")) return "falling_blocks";
  if (tags.includes("suffocation")) return "damage";
  if (tags.includes("food")) return "food";
  if (tags.includes("nether")) return "nether";
  if (tags.includes("fluids")) return "hazards";
  if (tags.includes("tools")) return "tools";
  if (tags.includes("shelter")) return "shelter";
  if (tags.includes("mining")) return "mining";
  if (tags.includes("survival_progression")) return "survival_progression";
  return "minecraft_wiki";
}

function inferTasks(tags) {
  const tasks = new Set(["diagnostics"]);
  if (tags.includes("falling_blocks") || tags.includes("mining")) tasks.add("collect_stone");
  if (tags.includes("suffocation") || tags.includes("damage")) tasks.add("escape_hazard");
  if (tags.includes("food")) tasks.add("hunt_food");
  if (tags.includes("nether")) tasks.add("mine_advanced_materials");
  if (tags.includes("fluids")) tasks.add("escape_hazard");
  if (tags.includes("tools")) tasks.add("craft_basic_tools");
  if (tags.includes("shelter")) tasks.add("build_shelter");
  if (tags.includes("survival_progression")) {
    tasks.add("collect_wood");
    tasks.add("craft_basic_supplies");
    tasks.add("build_shelter");
  }
  return [...tasks].sort();
}

function inferRules(tags) {
  const rules = [];
  if (tags.includes("falling_blocks")) {
    rules.push("Use this local wiki chunk when deciding whether sand, gravel, or concrete powder can fall after support is removed.");
    rules.push("For execution, validate the target block, support block, stand position, and body column before digging.");
  }
  if (tags.includes("suffocation")) {
    rules.push("Treat block occupancy in the feet/head space as a real survival hazard requiring escape or clearing.");
  }
  if (tags.includes("mining")) {
    rules.push("Prefer stable side-stand mining and reject unstable terrain before opening a mine probe.");
  }
  return rules;
}

function pageToDocuments(page, options = {}) {
  const paragraphs = paragraphsFromExtract(page.extract);
  const chunks = chunkParagraphs(paragraphs, options.chunking);
  const pageSlug = slugify(page.title);
  const retrievedAt = page.retrievedAt ?? new Date().toISOString();

  return chunks.map((content, index) => {
    const tags = inferTags(page.title, content);
    return {
      id: `minecraft_wiki:${pageSlug}:${String(index + 1).padStart(3, "0")}`,
      title: `${page.title} #${index + 1}`,
      topic: inferTopic(page.title, content),
      tasks: inferTasks(tags),
      tags,
      source: "minecraft_wiki_local_crawl",
      sourceTitle: page.title,
      sourceUrl: page.fullurl,
      license: LICENSE,
      revisionId: page.revisionId ?? null,
      revisionTimestamp: page.revisionTimestamp ?? null,
      retrievedAt,
      content,
      rules: inferRules(tags),
      chunk: {
        index: index + 1,
        total: chunks.length,
        contentHash: sha256(content),
        sourceExtractHash: page.extractHash
      },
      quality: {
        extraction: "mediawiki_action_query_extracts_explaintext",
        pageAllowlisted: true,
        excludedSections: [...EXCLUDED_SECTION_TITLES].sort(),
        minChunkChars: options.chunking?.minChars ?? 280,
        maxChunkChars: options.chunking?.maxChars ?? 1100
      }
    };
  });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonl(filePath, values) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${values.map((value) => JSON.stringify(value)).join("\n")}\n`, "utf8");
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

function emptyDirectory(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function pageMetadata(page) {
  return {
    source: "minecraft_wiki_local_page",
    title: page.title,
    requestedTitle: page.requestedTitle ?? page.title,
    pageId: page.pageId ?? null,
    fullurl: page.fullurl,
    revisionId: page.revisionId ?? null,
    revisionTimestamp: page.revisionTimestamp ?? null,
    revisionSha1: page.revisionSha1 ?? null,
    retrievedAt: page.retrievedAt ?? null,
    extractHash: page.extractHash ?? sha256(page.extract ?? ""),
    license: LICENSE
  };
}

function pageToMarkdown(page) {
  const metadata = pageMetadata(page);
  return `<!-- minecraft-wiki-metadata\n${JSON.stringify(metadata, null, 2)}\n-->\n\n# ${page.title}\n\nSource: ${page.fullurl}\n\nRevision: ${page.revisionId ?? "unknown"}\n\nLicense: ${LICENSE.url}\n\nEdit the local wiki text below, then run npm run build:minecraft-wiki-rag to regenerate the RAG JSONL.\n\n## Local Wiki Text\n\n${normalizeWhitespace(page.extract)}\n`;
}

function parsePageMarkdown(markdown, filePath = "local-page.md") {
  const metadataMatch = String(markdown).match(/<!-- minecraft-wiki-metadata\s*([\s\S]*?)\s*-->/);
  if (!metadataMatch) throw new Error(`missing minecraft-wiki-metadata block in ${filePath}`);
  const metadata = JSON.parse(metadataMatch[1]);
  const marker = "## Local Wiki Text";
  const markerIndex = markdown.indexOf(marker);
  if (markerIndex === -1) throw new Error(`missing Local Wiki Text section in ${filePath}`);

  const extract = normalizeWhitespace(markdown.slice(markerIndex + marker.length));
  if (extract.length < 120) throw new Error(`local wiki page text too small in ${filePath}`);

  return {
    title: metadata.title ?? path.basename(filePath, ".md"),
    requestedTitle: metadata.requestedTitle ?? metadata.title,
    pageId: metadata.pageId ?? null,
    fullurl: metadata.fullurl,
    revisionId: metadata.revisionId ?? null,
    revisionTimestamp: metadata.revisionTimestamp ?? null,
    revisionSha1: metadata.revisionSha1 ?? null,
    retrievedAt: metadata.retrievedAt ?? null,
    extract,
    extractHash: sha256(extract)
  };
}

function documentToMarkdown(document) {
  const metadata = {
    id: document.id,
    source: document.source,
    sourceTitle: document.sourceTitle,
    sourceUrl: document.sourceUrl,
    revisionId: document.revisionId,
    revisionTimestamp: document.revisionTimestamp,
    retrievedAt: document.retrievedAt,
    tags: document.tags,
    tasks: document.tasks,
    chunk: document.chunk
  };
  return `<!-- minecraft-wiki-chunk-metadata\n${JSON.stringify(metadata, null, 2)}\n-->\n\n# ${document.title}\n\nSource: ${document.sourceUrl}\n\nTopic: ${document.topic}\n\nTags: ${document.tags.join(", ")}\n\n## Chunk Text\n\n${document.content}\n\n## Generated Rules\n\n${document.rules.map((rule) => `- ${rule}`).join("\n")}\n`;
}

function writeAuditableMarkdown(outputRoot, pages, documents, options = {}) {
  const pageDir = path.join(outputRoot, DEFAULT_PAGE_DIR);
  const chunkDir = path.join(outputRoot, DEFAULT_CHUNK_DIR);
  if (options.resetPages) emptyDirectory(pageDir);
  else fs.mkdirSync(pageDir, { recursive: true });
  emptyDirectory(chunkDir);

  for (const page of pages) {
    writeText(path.join(pageDir, `${slugify(page.requestedTitle ?? page.title)}.md`), pageToMarkdown(page));
  }
  for (const document of documents) {
    writeText(path.join(chunkDir, `${slugify(document.id)}.md`), documentToMarkdown(document));
  }

  return { pageDir, chunkDir };
}

function readLocalWikiPages(outputRoot = DEFAULT_OUTPUT_ROOT) {
  const pageDir = path.join(outputRoot, DEFAULT_PAGE_DIR);
  if (!fs.existsSync(pageDir)) return [];
  return fs.readdirSync(pageDir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => {
      const filePath = path.join(pageDir, name);
      return parsePageMarkdown(fs.readFileSync(filePath, "utf8"), filePath);
    });
}

function dedupeDocuments(documents) {
  const deduped = [];
  const seenHashes = new Set();
  for (const document of documents) {
    if (seenHashes.has(document.chunk.contentHash)) continue;
    seenHashes.add(document.chunk.contentHash);
    deduped.push(document);
  }
  return deduped;
}

function buildWikiCorpusFromLocalPages(options = {}) {
  const outputRoot = path.resolve(options.outputRoot ?? DEFAULT_OUTPUT_ROOT);
  const pages = options.pages ?? readLocalWikiPages(outputRoot);
  const documents = dedupeDocuments(pages.flatMap((page) => pageToDocuments(page, options)));
  const corpusPath = path.join(outputRoot, DEFAULT_WIKI_CORPUS_FILE);
  const { pageDir, chunkDir } = writeAuditableMarkdown(outputRoot, pages, documents);
  const manifestPath = path.join(outputRoot, DEFAULT_MANIFEST_FILE);
  const manifest = {
    source: "minecraft_wiki_local_markdown",
    generatedAt: options.now ? options.now() : new Date().toISOString(),
    pageMarkdownDir: pageDir,
    chunkMarkdownDir: chunkDir,
    corpusPath,
    pageCount: pages.length,
    documentCount: documents.length,
    pages: pages.map((page) => ({
      title: page.title,
      requestedTitle: page.requestedTitle ?? page.title,
      fullurl: page.fullurl,
      revisionId: page.revisionId,
      revisionTimestamp: page.revisionTimestamp,
      extractHash: page.extractHash
    })),
    license: LICENSE,
    qualityControls: {
      editableMarkdownSource: true,
      jsonlGeneratedFromLocalMarkdown: true,
      chunkMarkdownPreview: true,
      chunkDeduplication: "sha256_content_hash",
      excludedSections: [...EXCLUDED_SECTION_TITLES].sort()
    }
  };
  writeJsonl(corpusPath, documents);
  writeJson(manifestPath, manifest);
  return { outputRoot, corpusPath, manifestPath, pageDir, chunkDir, pages, documents, manifest };
}

async function fetchWikiPage(title, options = {}) {
  const apiUrl = options.apiUrl ?? DEFAULT_WIKI_API_URL;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available in this Node.js runtime");

  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    redirects: "1",
    prop: "extracts|info|revisions",
    titles: title,
    explaintext: "1",
    exsectionformat: "plain",
    inprop: "url",
    rvprop: "ids|timestamp|sha1"
  });
  const url = `${apiUrl}?${params.toString()}`;
  const response = await fetchImpl(url, {
    headers: {
      "accept": "application/json",
      "user-agent": options.userAgent ?? "mc-survival-bot-local-rag/0.1 (+local knowledge ingestion)"
    }
  });

  if (!response.ok) throw new Error(`wiki request failed for ${title}: HTTP ${response.status}`);
  const body = await response.json();
  const page = body?.query?.pages?.[0];
  if (!page || page.missing) throw new Error(`wiki page missing: ${title}`);
  const revision = page.revisions?.[0] ?? {};
  const extract = normalizeWhitespace(page.extract ?? "");
  if (extract.length < 120) throw new Error(`wiki page extract too small: ${title}`);

  return {
    title: page.title ?? title,
    requestedTitle: title,
    pageId: page.pageid ?? null,
    fullurl: page.fullurl ?? `https://minecraft.wiki/w/${encodeURIComponent(page.title ?? title).replace(/%20/g, "_")}`,
    revisionId: revision.revid ?? null,
    revisionTimestamp: revision.timestamp ?? null,
    revisionSha1: revision.sha1 ?? null,
    retrievedAt: options.now ? options.now() : new Date().toISOString(),
    extract,
    extractHash: sha256(extract)
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ingestMinecraftWiki(options = {}) {
  const outputRoot = path.resolve(options.outputRoot ?? DEFAULT_OUTPUT_ROOT);
  const pages = [...new Set(options.pages ?? DEFAULT_WIKI_PAGES)];
  const delayMs = Math.max(0, Number(options.delayMs ?? 500));
  const rawDir = path.join(outputRoot, DEFAULT_RAW_DIR);
  const rawPages = [];
  const documents = [];
  const failures = [];

  for (const [index, title] of pages.entries()) {
    try {
      const page = await fetchWikiPage(title, options);
      rawPages.push(page);
      documents.push(...pageToDocuments(page, options));
      writeJson(path.join(rawDir, `${slugify(page.requestedTitle ?? page.title)}.json`), page);
    } catch (error) {
      failures.push({ title, error: error.message });
    }
    if (delayMs > 0 && index < pages.length - 1) await delay(delayMs);
  }

  const deduped = dedupeDocuments(documents);
  const { pageDir, chunkDir } = writeAuditableMarkdown(outputRoot, rawPages, deduped, { resetPages: true });

  const manifest = {
    source: "minecraft_wiki_local_crawl",
    apiUrl: options.apiUrl ?? DEFAULT_WIKI_API_URL,
    generatedAt: options.now ? options.now() : new Date().toISOString(),
    requestedPages: pages,
    fetchedPages: rawPages.map((page) => ({
      title: page.title,
      requestedTitle: page.requestedTitle,
      pageId: page.pageId,
      fullurl: page.fullurl,
      revisionId: page.revisionId,
      revisionTimestamp: page.revisionTimestamp,
      extractHash: page.extractHash
    })),
    failedPages: failures,
    documentCount: deduped.length,
    pageMarkdownDir: pageDir,
    chunkMarkdownDir: chunkDir,
    license: LICENSE,
    qualityControls: {
      pageAllowlist: true,
      plaintextExtraction: true,
      rawExtractsStored: true,
      editableMarkdownSource: true,
      chunkMarkdownPreview: true,
      chunkDeduplication: "sha256_content_hash",
      excludedSections: [...EXCLUDED_SECTION_TITLES].sort()
    }
  };

  const corpusPath = path.join(outputRoot, DEFAULT_WIKI_CORPUS_FILE);
  writeJsonl(corpusPath, deduped);
  writeJson(path.join(outputRoot, DEFAULT_MANIFEST_FILE), manifest);

  return {
    outputRoot,
    corpusPath,
    manifestPath: path.join(outputRoot, DEFAULT_MANIFEST_FILE),
    rawDir,
    pageDir,
    chunkDir,
    documents: deduped,
    rawPages,
    failures,
    manifest
  };
}

module.exports = {
  DEFAULT_CHUNK_DIR,
  DEFAULT_MANIFEST_FILE,
  DEFAULT_OUTPUT_ROOT,
  DEFAULT_PAGE_DIR,
  DEFAULT_RAW_DIR,
  DEFAULT_WIKI_API_URL,
  DEFAULT_WIKI_CORPUS_FILE,
  DEFAULT_WIKI_PAGES,
  EXCLUDED_SECTION_TITLES,
  LICENSE,
  buildWikiCorpusFromLocalPages,
  chunkParagraphs,
  documentToMarkdown,
  fetchWikiPage,
  ingestMinecraftWiki,
  inferTags,
  pageToDocuments,
  pageToMarkdown,
  parsePageMarkdown,
  paragraphsFromExtract,
  readLocalWikiPages,
  slugify
};
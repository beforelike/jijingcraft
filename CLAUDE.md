# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository contains project-specific skills for Claude Code, specifically the **Multi Search Engine** skill installed from ClawHub (gpyangyoujun/multi-search-engine).

## Multi Search Engine Skill

**Location**: `.claude/skills/multi-search-engine/`

**Version**: 2.1.3

**Description**: Multi search engine integration with 16 engines (7 CN + 9 Global). Supports advanced search operators, time filters, site search, privacy engines, and WolframAlpha.

### When to Use

- Web search across multiple engines
- Chinese language queries (uses Domestic engines: Baidu, Bing CN, 360, Sogou, WeChat, Shenma)
- Non-Chinese queries (uses International engines: Google, DuckDuckGo, Yahoo, etc.)
- Site-specific search with `site:` operator
- File type search with `filetype:` operator
- Time-filtered search (past hour/day/week/month/year)
- Privacy-focused search (DuckDuckGo, Startpage, Brave, Qwant)
- Knowledge computation (WolframAlpha)
- DuckDuckGo bang shortcuts (`!g`, `!gh`, `!so`, `!w`, `!yt`)

### Search Engine Categories

**Domestic (7)**: Baidu, Bing CN, Bing INT, 360, Sogou, WeChat, Shenma

**International (9)**: Google, Google HK, DuckDuckGo, Yahoo, Startpage, Brave, Ecosia, Qwant, WolframAlpha

### Usage Pattern

```javascript
// Basic search
web_fetch({"url": "https://www.google.com/search?q=python+tutorial"})

// Site-specific
web_fetch({"url": "https://www.google.com/search?q=site:github.com+react"})

// File type
web_fetch({"url": "https://www.google.com/search?q=machine+learning+filetype:pdf"})

// Time filter (past week)
web_fetch({"url": "https://www.google.com/search?q=ai+news&tbs=qdr:w"})

// Privacy search
web_fetch({"url": "https://duckduckgo.com/html/?q=privacy+tools"})
```

### Rate Limiting Guidelines

- Add 1-2 second delay between requests
- Batch requests in groups of 3-4 engines
- Sequential execution between batches
- Retry once after 2-second delay on failure

### Cookie Management

- Cookies stored ONLY in memory during runtime
- Acquired on-demand when search requests fail (403/429)
- No cookies read from or written to disk
- Cleared after search session completes
- Only session cookies from search engine domains captured

### Skill Files

- `.claude/skills/multi-search-engine/skill.yaml` - Skill metadata and trigger conditions
- `.claude/skills/multi-search-engine/SKILL.md` - Detailed documentation

## License

MIT-0

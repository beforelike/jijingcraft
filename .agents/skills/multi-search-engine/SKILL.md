# Multi Search Engine

Multi search engine integration with 16 engines for web crawling without API keys.

## Overview

This skill provides integration with 16 search engines (7 Domestic CN + 9 Global) for comprehensive web search capabilities. It supports advanced search operators, time filters, site-specific search, privacy-focused engines, and WolframAlpha computations.

## Workflow

1. **Preparation**: AI Agent initializes an empty in-memory cookie store. Cookies are only acquired dynamically during search operations when access is denied

2. **Language Evaluation**: Detect the language attribute of the search query. If the query is in Chinese, use Domestic search engines. If the query is non-Chinese, use International search engines. Select engines based on query relevance and availability.

3. **Controlled Search**: Use web_fetch to execute search requests with rate limiting:
   - Add 1-2 second delay between requests to respect server load
   - Batch requests in groups of 3-4 engines with sequential execution between batches
   - Include standard browser headers to identify as legitimate user agent
   - If access is denied (403/429), fetch engine homepage to obtain fresh session cookies

4. **Cookie Management**:
   - Cookies are stored ONLY in memory during runtime
   - Cookies are acquired on-demand when search requests fail
   - No cookies are read from or written to config.json or any file
   - Cookies are cleared after search session completes
   - Only session cookies from search engine domains are captured

5. **Retry Mechanism**: If a search fails due to cookie/session issues, retry once with freshly acquired cookies after a 2-second delay

6. **Result Aggregation**: Consolidate successful results from search engines, organize and summarize them to output a core search report

## Search Engines

### Domestic (7)

| Engine | URL Pattern |
|--------|-------------|
| Baidu | `https://www.baidu.com/s?wd={keyword}` |
| Bing CN | `https://cn.bing.com/search?q={keyword}&ensearch=0` |
| Bing INT | `https://cn.bing.com/search?q={keyword}&ensearch=1` |
| 360 | `https://www.so.com/s?q={keyword}` |
| Sogou | `https://sogou.com/web?query={keyword}` |
| WeChat | `https://wx.sogou.com/weixin?type=2&query={keyword}` |
| Shenma | `https://m.sm.cn/s?q={keyword}` |

### International (9)

| Engine | URL Pattern |
|--------|-------------|
| Google | `https://www.google.com/search?q={keyword}` |
| Google HK | `https://www.google.com.hk/search?q={keyword}` |
| DuckDuckGo | `https://duckduckgo.com/html/?q={keyword}` |
| Yahoo | `https://search.yahoo.com/search?p={keyword}` |
| Startpage | `https://www.startpage.com/sp/search?query={keyword}` |
| Brave | `https://search.brave.com/search?q={keyword}` |
| Ecosia | `https://www.ecosia.org/search?q={keyword}` |
| Qwant | `https://www.qwant.com/?q={keyword}` |
| WolframAlpha | `https://www.wolframalpha.com/input?i={keyword}` |

## Usage Examples

### Basic search
```javascript
web_fetch({"url": "https://www.google.com/search?q=python+tutorial"})
```

### Site-specific
```javascript
web_fetch({"url": "https://www.google.com/search?q=site:github.com+react"})
```

### File type
```javascript
web_fetch({"url": "https://www.google.com/search?q=machine+learning+filetype:pdf"})
```

### Time filter (past week)
```javascript
web_fetch({"url": "https://www.google.com/search?q=ai+news&tbs=qdr:w"})
```

### Privacy search
```javascript
web_fetch({"url": "https://duckduckgo.com/html/?q=privacy+tools"})
```

### DuckDuckGo Bangs
```javascript
web_fetch({"url": "https://duckduckgo.com/html/?q=!gh+tensorflow"})
```

### Knowledge calculation
```javascript
web_fetch({"url": "https://www.wolframalpha.com/input?i=100+USD+to+CNY"})
```

## Advanced Operators

| Operator | Example | Description |
|----------|---------|-------------|
| `site:` | `site:github.com python` | Search within site |
| `filetype:` | `filetype:pdf report` | Specific file type |
| `""` | `"machine learning"` | Exact match |
| `-` | `python -snake` | Exclude term |
| `OR` | `cat OR dog` | Either term |

## Time Filters

| Parameter | Description |
|-----------|-------------|
| `tbs=qdr:h` | Past hour |
| `tbs=qdr:d` | Past day |
| `tbs=qdr:w` | Past week |
| `tbs=qdr:m` | Past month |
| `tbs=qdr:y` | Past year |

## Privacy Engines

- **DuckDuckGo**: No tracking
- **Startpage**: Google results + privacy
- **Brave**: Independent index
- **Qwant**: EU GDPR compliant

## Bangs Shortcuts (DuckDuckGo)

| Bang | Destination |
|------|-------------|
| `!g` | Google |
| `!gh` | GitHub |
| `!so` | Stack Overflow |
| `!w` | Wikipedia |
| `!yt` | YouTube |

## WolframAlpha Queries

- Math: `integrate x^2 dx`
- Conversion: `100 USD to CNY`
- Stocks: `AAPL stock`
- Weather: `weather in Beijing`

## Language Detection

The skill automatically detects the query language:
- **Chinese queries**: Use Domestic engines (Baidu, Bing CN, 360, Sogou, WeChat, Shenma)
- **Non-Chinese queries**: Use International engines (Google, DuckDuckGo, Yahoo, Startpage, Brave, Ecosia, Qwant, WolframAlpha)

## Rate Limiting

To respect server resources:
- 1-2 second delay between requests
- Batch in groups of 3-4 engines
- Sequential execution between batches
- Retry once after 2-second delay on failure

## Metadata

- **Version**: 2.1.3
- **Author**: gpyangyoujun
- **License**: MIT-0

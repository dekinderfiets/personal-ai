# X Digest

Generates rich digests from X/Twitter based on your preferences—news, feed, bookmarks, mentions, or any other available source.

## Purpose

Creates customized digests from various X sources. Whether you want trending news, your personalized feed, saved bookmarks, or mentions—this plugin fetches, filters, and summarizes the content into a clean, newspaper-style digest focused on insights and context.

## Capabilities

- Fetch content from multiple X sources (news, feed, bookmarks, mentions, likes, search)
- Filter content by engagement and relevance patterns
- Cluster discussions into trending topics and themes
- Identify emerging trends and discussion patterns
- Analyze why topics are gaining traction
- Generate context-rich summaries focused on trends and insights

## When to Use

Use this plugin when:
- You want a digest of trending news and discussions
- You want to catch up on your personal X feed
- You want to review your bookmarks in a summarized format
- You need to see what mentions you've received with context
- You want to search for a topic and get a curated digest
- You seek insights about what's trending in your network

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `source` | Yes | The content source: `news`, `feed`, `bookmarks`, `mentions`, `likes`, or `search:<query>` |
| `count` | No | Number of items to fetch (default: 50, max: 100) |
| `topics` | No | Focus topics to prioritize (e.g., "AI, tech, startups") |
| `min_engagement` | No | Minimum engagement threshold (default: 50 total interactions) |
| `include_threads` | No | Whether to expand notable threads (default: true) |

## Dependencies

- **Tools**: `bird` (for X access)
- **Other Plugins**: None

---

## Instructions

### Pre-Execution

1. Read `brain/guidelines.md` for output standards
2. Read `tools/bird/TOOL.md` to understand X access methods
3. Determine the source type and parameters from user request
4. Prepare engagement thresholds for filtering

### Step 1: Fetch Content
Use `skills/fetch_content`.

### Step 2: Filter & Score Content
Use `skills/filter_content`.

### Step 3: Identify Trends and Themes
Use `skills/identify_trends`.

### Step 4: Generate Digest
Use `skills/generate_digest`.


### Step 5: Return Results

1. Return the digest to the user


### Post-Execution

1. Report completion with digest highlights:
   - Number of trending topics identified
   - Top 3 trends and their significance
   - Key insights and patterns observed
2. Suggest follow-up actions (e.g., "Consider exploring related topics in more depth")

### Error Handling

- **Cannot access X**: Report auth issue, check bird skill for token refresh
- **Rate limited**: Reduce item count, report partial results
- **Empty results**: Report no content found, suggest checking later
- **Low-quality results**: Lower engagement threshold, report thinner digest

---

## Example Requests

**News digest** (default behavior):
> "Prepare an X digest for news"

**Personal feed digest**:
> "Give me a digest of my X feed"

**Bookmarks review**:
> "Create a digest from my X bookmarks"

**Topic-focused search**:
> "Prepare an X digest about AI developments"

**Mentions catch-up**:
> "Summarize my X mentions from today"

---

## Customization Tips

**For tech-focused digests**: Add search terms like "AI", "programming", "startup" to identify relevant trends

**For comprehensive analysis**: Increase count to 80-100, lower engagement threshold for broader trend detection

**For busy people**: Use news source with defaults, focus on 🟠 Trending section for quick insights

**To track specific topics**: Use the `search:<query>` source or add `topics` filter

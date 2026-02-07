# Filter Content

Filter and score tweets to remove noise.

## Purpose

Applies engagement scoring and heuristics to surface high-quality content.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `content` | Yes | List of tweets |
| `min_engagement` | No | Threshold (default: 50) |

## Instructions

### Step 1: Score Content

`score = (likes × 1) + (retweets × 2) + (replies × 1.5) + (quotes × 2)`

### Step 2: Apply Filters

1. **Threshold**: Skip score < `min_engagement` (except mentions/bookmarks).
2. **Recency**: Boost last 24h.
3. **Deduplication**: Remove duplicates.
4. **Noise Removal**: Filter low-effort posts.

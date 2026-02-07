# Generate Digest

Create the final markdown report.

## Purpose

Formats the analyzed trends into a newspaper-style digest.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `trends` | Yes | Analyzed topics |
| `source` | Yes | Source name |

## Instructions

### Step 1: Format Sections

Create markdown sections:
- **Header**: Date, source, stats.
- **Trending**: Top stories.
- **Notable**: Other news.
- **Insights**: Analysis.
- **Stats**: Engagement metrics.

### Step 2: Return Result

Return the full markdown string to the user.

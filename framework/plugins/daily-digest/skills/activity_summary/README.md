# Activity Summary

Summarize activity across all sources for a given date range.

## Purpose

Produces a comprehensive activity report showing what happened across all connectors during a specified time period. Useful for end-of-day reviews, catching up after time off, or reviewing any past period.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `start_date` | Yes | Start of the period (ISO 8601) |
| `end_date` | Yes | End of the period (ISO 8601) |
| `sources` | No | Limit to specific sources (default: all) |

## Outputs

- Activity counts per source
- Key items and highlights per source
- Timeline of significant events

## Instructions

### Step 1: Get Date Range

If the user said "yesterday", calculate yesterday's date range using the `time` tool.
If a custom range was provided, use those dates directly.

### Step 2: Query Each Source

Make parallel queries for each source within the date range.

**Calendar activity:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "events meetings",
    "sources": ["calendar"],
    "searchType": "keyword",
    "startDate": "<start_date>",
    "endDate": "<end_date>",
    "limit": 50
  }'
```

**Jira activity:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "updated created resolved",
    "sources": ["jira"],
    "searchType": "hybrid",
    "startDate": "<start_date>",
    "endDate": "<end_date>",
    "limit": 30
  }'
```

**Slack activity:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "messages conversations",
    "sources": ["slack"],
    "searchType": "hybrid",
    "startDate": "<start_date>",
    "endDate": "<end_date>",
    "limit": 30
  }'
```

**Gmail activity:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "emails received sent",
    "sources": ["gmail"],
    "searchType": "hybrid",
    "startDate": "<start_date>",
    "endDate": "<end_date>",
    "limit": 30
  }'
```

**Drive/Confluence activity:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "documents pages modified created",
    "sources": ["drive", "confluence"],
    "searchType": "hybrid",
    "startDate": "<start_date>",
    "endDate": "<end_date>",
    "limit": 20
  }'
```

**GitHub activity:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "pull request issue commit review",
    "sources": ["github"],
    "searchType": "hybrid",
    "startDate": "<start_date>",
    "endDate": "<end_date>",
    "limit": 20
  }'
```

### Step 3: Aggregate and Summarize

For each source, compute:
- **Count** of items found
- **Key items** (top 3-5 most relevant by score)
- **Themes** (group related items together)

### Step 4: Format Output

```markdown
# Activity Summary — [Date Range Description]

## Overview
| Source | Items | Highlights |
|--------|-------|------------|
| Calendar | 5 events | Sprint Review, 1:1 with Manager |
| Jira | 8 updates | 2 resolved, 3 in progress |
| Slack | 15 messages | Active in #engineering, #design |
| Gmail | 7 emails | 3 require response |
| Drive | 2 docs | Architecture doc updated |
| GitHub | 4 items | 1 PR merged, 2 reviews pending |

## 📅 Calendar
[List of events with times]

## 📋 Jira
[Task updates grouped by project]

## 💬 Slack
[Key conversations grouped by channel]

## 📧 Email
[Important emails with subject and sender]

## 📄 Documents
[Modified documents with links]

## 🐙 GitHub
[PRs, issues, reviews with links]
```

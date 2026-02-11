# Stale Items

Find items across all sources that haven't been updated within a configurable threshold.

## Purpose

Identifies work items, documents, and conversations that may have been forgotten or abandoned. Helps prevent items from falling through the cracks by surfacing anything that's gone stale.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `threshold_days` | No | Days without update to consider stale (default: 14) |
| `sources` | No | Limit to specific sources (default: all) |

## Outputs

- Categorized list of stale items per source with age and last activity

## Instructions

### Step 1: Get Current Time

Use the `time` tool. Calculate the staleness cutoff date:
- `cutoff_date`: Current date minus `threshold_days` (default: 14 days ago)

### Step 2: Find Stale Jira Issues

Search for open issues that haven't been updated recently.

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "open assigned in progress to do",
    "sources": ["jira"],
    "searchType": "hybrid",
    "limit": 30
  }'
```

**Processing:**
- Filter to open items (status not "Done" / "Closed" / "Resolved")
- Filter to items where `metadata.updatedAt` < `cutoff_date`
- Sort by staleness (oldest update first)
- For each: extract title, status, last update date, assignee, url

### Step 3: Find Stale GitHub Items

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "open pull request issue stale",
    "sources": ["github"],
    "searchType": "hybrid",
    "where": { "state": "open" },
    "limit": 20
  }'
```

**Processing:**
- Filter to items where `metadata.updatedAt` < `cutoff_date`
- Flag PRs with no review activity as particularly stale
- Sort by age descending

### Step 4: Find Stale Documents

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "draft review pending document page",
    "sources": ["drive", "confluence"],
    "searchType": "hybrid",
    "limit": 20
  }'
```

**Processing:**
- Filter to documents owned by the user or where user is a recent editor
- Filter to documents not updated since `cutoff_date`
- Look for documents with "draft", "WIP", "review" in the title — these are particularly likely forgotten
- Sort by last modified ascending

### Step 5: Find Old Unresolved Threads

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "question unresolved thread help needed",
    "sources": ["slack"],
    "searchType": "hybrid",
    "endDate": "<cutoff_date>",
    "limit": 15
  }'
```

**Processing:**
- Identify threads where the user was involved but no recent activity
- Only include threads with open-ended questions or unresolved discussions

### Step 6: Format Output

```markdown
## 🕸️ Stale Items (X total)

### Jira Issues (X items)
| Issue | Status | Last Updated | Age |
|-------|--------|-------------|-----|
| [PROJ-18] Update onboarding flow | In Progress | Jan 15 | 26d |
| [PROJ-33] Fix caching layer | To Do | Jan 22 | 19d |

### GitHub (X items)
| Item | Type | Last Updated | Age |
|------|------|-------------|-----|
| PR #189: Refactor auth | PR | Jan 20 | 21d |
| Issue #45: Memory leak | Issue | Jan 25 | 16d |

### Documents (X items)
| Document | Source | Last Modified | Age |
|----------|--------|--------------|-----|
| API Design Draft | Drive | Jan 10 | 31d |
| Sprint Retro Notes | Confluence | Jan 18 | 23d |

### Slack Threads (X items)
| Channel | Topic | Last Activity | Age |
|---------|-------|--------------|-----|
| #architecture | Database migration plan | Jan 12 | 29d |
```

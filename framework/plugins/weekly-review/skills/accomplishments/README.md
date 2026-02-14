# Accomplishments

Extract concrete accomplishments from the week's activity for standups, reviews, and status reports.

## Purpose

Mines all indexed data to identify and articulate specific accomplishments. Transforms raw activity (task status changes, resolved threads) into clear accomplishment statements suitable for standups, manager updates, and performance reviews.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `week_start` | Yes | Start of the period (ISO 8601) |
| `week_end` | Yes | End of the period (ISO 8601) |
| `format` | No | `detailed` (default), `standup` (bullet points), `review` (formal accomplishments) |

## Outputs

- List of accomplishments with supporting evidence and links

## Instructions

### Step 1: Get Date Range

Use the dates provided or calculate the current week using the `time` tool.

### Step 2: Find Completed Work

**Jira issues resolved:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "resolved completed done closed fixed",
    "sources": ["jira"],
    "searchType": "hybrid",
    "startDate": "<week_start>",
    "endDate": "<week_end>",
    "limit": 30
  }'
```

**Processing:**
- Filter to issues where `metadata.status` is "Done", "Resolved", or "Closed"
- Filter to issues where `metadata.updatedAt` falls within the date range
- Prioritize issues assigned to the user
- For each: extract key, title, project, url

### Step 3: Find Documents Created/Updated

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "created updated document page",
    "sources": ["drive", "confluence"],
    "searchType": "hybrid",
    "startDate": "<week_start>",
    "endDate": "<week_end>",
    "limit": 15
  }'
```

**Processing:**
- Filter to documents owned or authored by the user
- Distinguish between created (new) and updated (existing)

### Step 4: Find Key Decisions and Discussions

Search for significant conversations where decisions were made.

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "decided agreed approved shipped launched released",
    "sources": ["slack", "gmail"],
    "searchType": "hybrid",
    "startDate": "<week_start>",
    "endDate": "<week_end>",
    "limit": 15
  }'
```

### Step 5: Generate Accomplishments

Transform raw data into accomplishment statements. Each accomplishment should:
1. Start with an action verb (Completed, Shipped, Resolved, Reviewed, Authored, Led, ...)
2. Describe what was done
3. Note the impact or context
4. Include a source link

**Format by output type:**

#### `detailed` (default)
```markdown
## 🏆 Accomplishments

### Completed Tasks
- **Completed [PROJ-42]: Fix login bug** — Resolved critical authentication issue affecting 200+ users. High priority. [→ link]
- **Completed [PROJ-38]: Update API docs** — Documented 12 new endpoints for the v2 API. [→ link]

### Documents & Collaboration
- **Authored design doc**: "Authentication Architecture v2" on Confluence [→ link]

### Key Discussions & Decisions
- Led API design discussion in #engineering — agreed on REST + GraphQL hybrid approach
- Aligned with product on Q1 priorities via email thread
```

#### `standup` format
```markdown
## This Week
- Completed PROJ-42 (login bug fix) and PROJ-38 (API docs)
- Wrote auth architecture design doc
- Led API design discussion — decided on REST+GraphQL

## Next Week
- Start PROJ-55: API migration
- Sprint planning for Q1 features
```

#### `review` format (for performance reviews)
```markdown
## Week of Feb 3-7, 2026

**Engineering Delivery:**
- Resolved critical authentication bug (PROJ-42), unblocking 200+ affected users

**Technical Leadership:**
- Authored "Authentication Architecture v2" design document establishing team standards
- Led cross-team API design discussion, driving consensus on REST+GraphQL hybrid approach

**Collaboration:**
- Coordinated with product team on Q1 priority alignment
- Actively participated in sprint planning and retrospective
```

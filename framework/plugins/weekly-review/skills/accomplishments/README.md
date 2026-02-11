# Accomplishments

Extract concrete accomplishments from the week's activity for standups, reviews, and status reports.

## Purpose

Mines all indexed data to identify and articulate specific accomplishments. Transforms raw activity (task status changes, merged PRs, resolved threads) into clear accomplishment statements suitable for standups, manager updates, and performance reviews.

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

### Step 3: Find Merged Code

**Merged PRs:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "pull request merged closed completed",
    "sources": ["github"],
    "searchType": "hybrid",
    "startDate": "<week_start>",
    "endDate": "<week_end>",
    "limit": 20
  }'
```

**Processing:**
- Filter to PRs authored by the user (`metadata.is_author` = true)
- Filter to merged PRs (`metadata.state` = "closed" and type = "pull_request")
- For each: extract title, repo, url

### Step 4: Find Reviews Completed

**PR reviews given:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "review comment approved changes requested",
    "sources": ["github"],
    "searchType": "hybrid",
    "where": { "type": "pr_review" },
    "startDate": "<week_start>",
    "endDate": "<week_end>",
    "limit": 15
  }'
```

### Step 5: Find Documents Created/Updated

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

### Step 6: Find Key Decisions and Discussions

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

### Step 7: Generate Accomplishments

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

### Code Shipped
- **Merged PR #234: Add auth middleware** — Implemented JWT-based authentication for the API gateway. [→ link]
- **Merged PR #228: Database migration** — Migrated user table to support multi-tenancy. [→ link]

### Reviews & Collaboration
- **Reviewed 4 PRs** across myapp and mylib repositories
- **Authored design doc**: "Authentication Architecture v2" on Confluence [→ link]

### Key Discussions & Decisions
- Led API design discussion in #engineering — agreed on REST + GraphQL hybrid approach
- Aligned with product on Q1 priorities via email thread
```

#### `standup` format
```markdown
## This Week
- Completed PROJ-42 (login bug fix) and PROJ-38 (API docs)
- Merged 2 PRs: auth middleware and DB migration
- Reviewed 4 PRs
- Wrote auth architecture design doc
- Led API design discussion — decided on REST+GraphQL

## Next Week
- Start PROJ-55: API migration
- Review and merge pending PRs
- Sprint planning for Q1 features
```

#### `review` format (for performance reviews)
```markdown
## Week of Feb 3-7, 2026

**Engineering Delivery:**
- Resolved critical authentication bug (PROJ-42), unblocking 200+ affected users
- Shipped JWT auth middleware for API gateway (PR #234), enabling secure third-party integrations
- Completed database migration to multi-tenant architecture (PR #228)

**Technical Leadership:**
- Authored "Authentication Architecture v2" design document establishing team standards
- Led cross-team API design discussion, driving consensus on REST+GraphQL hybrid approach
- Provided thorough code reviews on 4 PRs, mentoring junior engineers on security practices

**Collaboration:**
- Coordinated with product team on Q1 priority alignment
- Actively participated in sprint planning and retrospective
```

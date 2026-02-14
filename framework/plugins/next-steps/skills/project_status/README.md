# Project Status

Search across all connectors for data related to a specific project or topic and synthesize a comprehensive status report.

## Purpose

Builds a 360-degree view of a project by searching every connector for related items. Combines Jira tickets, Slack conversations, emails, documents, and calendar events into a single coherent status report.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `project` | Yes | Project name, topic, keyword, or Jira project key |
| `depth` | No | `brief` (quick overview) or `detailed` (full report, default) |

## Outputs

- Comprehensive project status report with data from all relevant sources

## Instructions

### Step 1: Search All Sources

Make a broad search across all connectors using the project name/topic.

**Primary search:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "<project_name>",
    "searchType": "hybrid",
    "limit": 50
  }'
```

If the project appears to be a Jira project key (e.g., "PROJ"), also do a targeted search:
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "<project_key>",
    "sources": ["jira"],
    "searchType": "keyword",
    "limit": 30
  }'
```

### Step 2: Categorize Results

Group results by source and type:
- **Tasks**: Jira issues (open vs closed, by status)
- **Conversations**: Slack threads mentioning the project
- **Emails**: Email threads about the project
- **Documents**: Drive docs and Confluence pages
- **Meetings**: Calendar events related to the project

### Step 3: Analyze Status

For each category, extract key metrics:

**Tasks:**
- Total open issues
- Issues by status (To Do, In Progress, Done, Blocked)
- Recent completions (last 7 days)
- Blockers or high-priority items

**Communication:**
- Active Slack channels/threads
- Recent email volume
- Key discussion themes

**Documents:**
- Recently updated docs
- Key artifacts (design docs, specs, READMEs)

**Timeline:**
- Upcoming deadlines or milestones
- Recent meetings and next scheduled meeting

### Step 4: Synthesize Report

```markdown
# Project Status: [Project Name]
*Generated on [date]*

## Executive Summary
[2-3 sentence overview of the project's current state, health, and momentum]

## Health Indicators
| Metric | Status |
|--------|--------|
| Open Issues | X (Y critical) |
| Last Activity | [timestamp] |
| Upcoming Deadline | [date or "None"] |
| Blockers | X items |

## 📋 Tasks & Issues
### Open (X)
[List grouped by status]

### Recently Completed (X)
[List of items closed in last 7 days]

### Blockers
[Any blocked or critical items]

## 💬 Recent Discussions
[Key Slack threads and email conversations]

## 📄 Key Documents
[Relevant Drive/Confluence docs with links]

## 📅 Timeline
- **Next meeting**: [date/time]
- **Upcoming deadlines**: [list]

## Recommendations
[AI-generated suggestions based on the data: stale items to address, blockers to resolve, follow-ups needed]
```

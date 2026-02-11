# Context Builder

Build a comprehensive context briefing for any topic or project by searching across all connectors and combining the data.

## Purpose

When you need to get up to speed on a topic, project, or person, this skill searches every connector and synthesizes all related data into a coherent briefing. Produces a "everything we know about X" document.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `topic` | Yes | The topic, project, person, or keyword to build context for |
| `depth` | No | `brief` (top items only) or `comprehensive` (everything, default) |
| `time_range` | No | How far back to search (default: 90 days) |

## Outputs

- Comprehensive context briefing with all relevant data from all sources

## Instructions

### Step 1: Get Current Time

Use the `time` tool. Calculate `search_start` based on `time_range` (default: 90 days ago).

### Step 2: Broad Search

Search across all sources for the topic.

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "<topic>",
    "searchType": "hybrid",
    "startDate": "<search_start>",
    "limit": 50
  }'
```

### Step 3: Source-Specific Deep Dives

Based on initial results, make targeted follow-up queries for sources that returned relevant hits.

**If Jira results found — get full project context:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "<topic> <related_project_key>",
    "sources": ["jira"],
    "searchType": "hybrid",
    "startDate": "<search_start>",
    "limit": 30
  }'
```

**If Slack results found — get full conversation context:**
For each relevant Slack message, use the navigate endpoint to get the full thread:
```bash
curl -X GET "${COLLECTOR_API_URL}/navigate/<message_id>?direction=children&scope=datapoint&limit=20" \
  -H "x-api-key: ${COLLECTOR_API_KEY}"
```

**If email results found — get full threads:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "<topic>",
    "sources": ["gmail"],
    "searchType": "hybrid",
    "startDate": "<search_start>",
    "limit": 20
  }'
```

For each relevant email, navigate to get the full thread:
```bash
curl -X GET "${COLLECTOR_API_URL}/navigate/<email_id>?direction=siblings&scope=datapoint&limit=20" \
  -H "x-api-key: ${COLLECTOR_API_KEY}"
```

**If document results found — get related docs:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "<topic>",
    "sources": ["drive", "confluence"],
    "searchType": "hybrid",
    "startDate": "<search_start>",
    "limit": 15
  }'
```

### Step 4: Build Timeline

Arrange all collected items chronologically to understand the story:
1. When was this topic first mentioned?
2. What were the key decision points?
3. What's the current state?
4. What's pending or upcoming?

### Step 5: Identify Key People

Extract all people involved with the topic:
- Who created items related to it?
- Who's assigned to work on it?
- Who's been commenting/discussing it?
- Who's the decision maker?

### Step 6: Synthesize Briefing

```markdown
# Context Briefing: [Topic]
*Generated on [date] — covering last [time_range]*

## TL;DR
[2-3 sentence summary of the topic: what it is, current state, what needs attention]

## Timeline
| Date | Event | Source |
|------|-------|--------|
| Jan 5 | Topic first discussed in #engineering | Slack |
| Jan 10 | [PROJ-30] created: "Implement [topic]" | Jira |
| Jan 15 | Design doc shared: "[Topic] Architecture" | Drive |
| Jan 20 | Sprint planning — topic prioritized | Calendar |
| Feb 1 | PR #200 opened: "Initial [topic] implementation" | GitHub |
| Feb 5 | @alice raised concerns in email thread | Gmail |
| Feb 8 | Status update in #engineering | Slack |

## Current State
[Narrative summary of where things stand right now]

### Open Items
[List of open Jira issues, GitHub PRs, pending decisions]

### Recent Activity
[What happened in the last few days]

## Key People
| Person | Role | Last Activity |
|--------|------|--------------|
| @alice | Lead developer | Feb 8 |
| @bob | Product owner | Feb 5 |
| @carol | Reviewer | Feb 1 |

## Key Documents
| Document | Source | Last Updated |
|----------|--------|-------------|
| [Topic] Architecture | Drive | Jan 15 |
| [Topic] Requirements | Confluence | Jan 12 |

## Key Discussions
[Summary of important Slack threads and email conversations]

## Open Questions / Blockers
[Things that are unresolved or blocking progress]

## Recommendations
[AI-generated suggestions for what to do next]
```

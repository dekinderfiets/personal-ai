# Suggest Next Actions

Analyze all pending work and recommend the top actions to take right now.

## Purpose

Combines data from all sources to build a holistic view of what's pending, then applies priority logic to recommend the most impactful next actions. Considers urgency, importance, staleness, and context.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `max_suggestions` | No | Number of suggestions to return (default: 5) |
| `sources` | No | Limit to specific sources (default: all) |

## Outputs

- Ranked list of suggested actions with reasoning and links

## Instructions

### Step 1: Get Current Time

Use the `time` tool. Calculate reference timestamps:
- `now`: Current UTC time
- `today_start`: Start of today
- `yesterday_start`: Start of yesterday
- `week_ago`: 7 days ago

### Step 2: Gather Pending Work

Make these queries in parallel to collect all pending items:

**Open Jira issues assigned to me:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "assigned open in progress to do blocked",
    "sources": ["jira"],
    "searchType": "hybrid",
    "limit": 25
  }'
```

**Today's calendar events (for context):**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "events meetings today",
    "sources": ["calendar"],
    "searchType": "keyword",
    "startDate": "<today_start>",
    "endDate": "<today_end>",
    "limit": 20
  }'
```

**Slack threads awaiting response:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "question help waiting response mention",
    "sources": ["slack"],
    "searchType": "hybrid",
    "startDate": "<yesterday_start>",
    "limit": 20
  }'
```

**Unanswered emails:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "action required response needed reply",
    "sources": ["gmail"],
    "searchType": "hybrid",
    "startDate": "<week_ago>",
    "limit": 15
  }'
```

**Pending GitHub reviews and issues:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "review requested assigned open pull request",
    "sources": ["github"],
    "searchType": "hybrid",
    "where": { "state": "open" },
    "limit": 15
  }'
```

### Step 3: Score and Rank Items

Apply this scoring framework to each item:

| Factor | Weight | Logic |
|--------|--------|-------|
| **Urgency** | 30% | Due dates, deadlines, how long it's been waiting |
| **Importance** | 25% | Priority level, who's asking/blocking, business impact |
| **Staleness** | 20% | How long since last update (`days_since_update`) |
| **Context Fit** | 15% | Does it relate to today's meetings or active work? |
| **Effort** | 10% | Quick wins get a boost (can be done in <15 min) |

**Urgency scoring:**
- Overdue by >3 days: 10
- Overdue by 1-3 days: 8
- Due today: 7
- Due tomorrow: 5
- Due this week: 3
- No due date: 1

**Importance scoring:**
- Critical/Blocker priority: 10
- High priority: 7
- From manager/leadership: 8
- DM or direct mention: 6
- Medium priority: 4
- Low/no priority: 2

**Staleness scoring:**
- Hasn't been updated in >14 days: 10
- 7-14 days since update: 7
- 3-7 days: 4
- <3 days: 1

### Step 4: Generate Suggestions

Select the top `max_suggestions` items by composite score. For each:

1. **Action**: What specifically to do (e.g., "Respond to Alice's PR review", "Update PROJ-42 status")
2. **Reasoning**: Why this is a priority (e.g., "Overdue by 2 days, blocking sprint completion")
3. **Source**: Where this item lives (with link)
4. **Estimated effort**: Quick (<15min), Medium (15-60min), or Deep (>1h)

### Step 5: Format Output

```markdown
## 🎯 Suggested Next Actions

### 1. Respond to PR review #234
**Why**: Review requested 28h ago by Alice, blocking the auth feature branch
**Source**: GitHub — [PR #234: Add auth middleware](link)
**Effort**: Quick (~15 min)

### 2. Update PROJ-42: Fix login bug
**Why**: High priority, assigned to you, no update in 5 days
**Source**: Jira — [PROJ-42](link)
**Effort**: Deep (~2h)

### 3. Reply to CEO email: Q4 Budget Review
**Why**: Direct email, sent 24h ago, no response yet
**Source**: Gmail — [Q4 Budget Review](link)
**Effort**: Medium (~30 min)

### 4. Answer @bob in #engineering
**Why**: Direct question about API design, waiting since yesterday
**Source**: Slack — [#engineering thread](link)
**Effort**: Quick (~10 min)

### 5. Prepare for Sprint Review (2:00 PM today)
**Why**: Meeting in 3 hours, prep needed
**Source**: Calendar — [Sprint Review](link)
**Effort**: Medium (~30 min)
```

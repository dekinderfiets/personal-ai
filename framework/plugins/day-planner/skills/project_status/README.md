# Project Status (Day Planner)

Build a status snapshot for a single project, scoped to day-planning needs and filtered by the user's role.

## Purpose

Produces a focused status snapshot for one project by querying relevant collector sources. The depth of data gathered depends on the user's role in the project: `active` projects get full detail, `informed` projects get key changes only, and `muted` projects are skipped entirely.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `project` | Yes | Project object from the Projects API (includes `title`, `sources`, `myRole`, `goals`, `participants`) |
| `date` | No | Target date (default: today, from `time` tool) |

## Outputs

Structured status object:

```json
{
  "projectTitle": "Project Alpha",
  "role": "active",
  "recentActivity": [
    { "source": "jira", "summary": "3 tasks in progress, 1 blocked", "items": [...] },
    { "source": "slack", "summary": "2 mentions in #alpha-dev", "items": [...] }
  ],
  "myTasks": [
    { "key": "PROJ-42", "title": "Fix login bug", "status": "In Progress", "priority": "High", "dueDate": "2026-02-13", "url": "..." }
  ],
  "blockers": [
    { "key": "PROJ-39", "title": "Waiting on API access", "blockedSince": "2026-02-10", "url": "..." }
  ],
  "nextActions": [
    "Complete PROJ-42 (overdue)",
    "Reply to @alice about deployment timeline"
  ],
  "meetings": [
    { "title": "Daily Standup", "start": "09:00", "end": "09:30", "url": "..." }
  ]
}
```

## Instructions

### Step 1: Get Current Date/Time

Use the `time` tool to get today's date in ISO 8601 format. Calculate:
- `today_start`: Start of day in UTC (e.g., `2026-02-14T00:00:00Z`)
- `today_end`: End of day in UTC (e.g., `2026-02-14T23:59:59Z`)
- `yesterday_start`: Start of yesterday in UTC (for catching overnight activity)

### Step 2: Check Role

Determine behavior based on `project.myRole`:

- **`active`**: Full data gathering (Steps 3-6)
- **`informed`**: Key changes only (Step 7)
- **`muted`**: Return immediately with `{ "projectTitle": "...", "role": "muted", "skipped": true }`

### Step 3: Search Jira for Tasks (Active Role)

Use the project's Jira source identifier (from `project.sources` where `type === "jira_project"`) to find assigned tasks.

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "<jira_project_key> assigned open in progress to do blocked",
    "sources": ["jira"],
    "searchType": "hybrid",
    "limit": 30
  }'
```

**Processing:**
- Filter to items where `metadata.is_assigned_to_me` is true or status is "In Progress" / "To Do" / "Blocked"
- Sort by priority: Critical > High > Medium > Low
- Flag overdue items (due date < today)
- Extract: key, title, status, priority, due date, url
- Separate blockers into the `blockers` array

### Step 4: Search Slack for Mentions (Active Role)

Use the project's Slack source identifier (from `project.sources` where `type === "slack_channel"`) to find recent mentions and discussions.

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mention direct message <channel_identifier>",
    "sources": ["slack"],
    "searchType": "hybrid",
    "startDate": "<yesterday_start>",
    "limit": 15
  }'
```

**Processing:**
- Prioritize direct mentions and DMs over general channel activity
- Extract: author, channel, content snippet, timestamp, url
- Flag messages that appear to need a response (questions, requests)

### Step 5: Check Calendar for Project Meetings (Active Role)

Search for meetings related to the project.

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "<project_title> meeting standup review",
    "sources": ["calendar"],
    "searchType": "hybrid",
    "startDate": "<today_start>",
    "endDate": "<today_end>",
    "limit": 10
  }'
```

**Processing:**
- Sort by start time ascending
- Extract: title (summary), start, end, location, attendees, url
- Flag meetings starting within the next 2 hours

### Step 6: Search Documents (Active Role)

Check for recently modified Drive/Confluence documents related to the project.

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "<project_title> recent updates",
    "sources": ["drive", "confluence"],
    "searchType": "hybrid",
    "startDate": "<yesterday_start>",
    "limit": 5
  }'
```

**Processing:**
- Filter to documents the user owns or recently accessed
- Extract: title, type, last modified, url
- Note any documents that were shared with the user but not yet viewed

### Step 7: Key Changes Only (Informed Role)

For `informed` projects, make a single broad search to catch significant changes:

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "<project_title> status change blocker decision update",
    "searchType": "hybrid",
    "startDate": "<yesterday_start>",
    "limit": 10
  }'
```

**Processing:**
- Look for: status changes, blockers raised/resolved, key decisions made, deadline changes
- Summarize into 2-3 bullet points of what changed
- Only include items that the user should be aware of — no noise
- Populate `recentActivity` and `nextActions` (if any awareness actions needed)
- Leave `myTasks` and `blockers` empty (user is not actively working on this project)

### Step 8: Compile Status Object

Assemble the output structure:
- `projectTitle`: From the project object
- `role`: From `project.myRole`
- `recentActivity`: Grouped by source, each with a summary and item list
- `myTasks`: Jira tasks assigned to the user, sorted by priority
- `blockers`: Any blocked items or external dependencies
- `nextActions`: AI-generated suggested actions (e.g., "Complete PROJ-42", "Reply to @alice")
- `meetings`: Today's project-related meetings

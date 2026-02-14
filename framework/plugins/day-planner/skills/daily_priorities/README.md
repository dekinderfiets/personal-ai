# Daily Priorities

Cross-project priority analysis that synthesizes all project status snapshots into a ranked, actionable daily plan.

## Purpose

Takes the output of all `project_status` skill invocations and produces a unified priority ranking across projects. Identifies conflicts, suggests focus blocks, and surfaces items needing immediate response. This is the synthesis step that turns per-project data into a coherent day plan.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `projectSnapshots` | Yes | Array of status objects from `project_status` skill (one per project) |
| `date` | No | Target date (default: today, from `time` tool) |

## Outputs

Structured priority analysis:

```json
{
  "priorities": [
    {
      "rank": 1,
      "category": "urgent",
      "action": "Complete PROJ-42: Fix login bug",
      "project": "Project Alpha",
      "reason": "Overdue by 1 day, High priority",
      "url": "..."
    }
  ],
  "conflicts": [
    {
      "type": "meeting_overlap",
      "description": "Sprint Review (14:00-15:00) overlaps with Beta Sync (14:30-15:30)",
      "suggestion": "Decline Beta Sync — Sprint Review is higher priority"
    }
  ],
  "focusBlocks": [
    {
      "start": "09:30",
      "end": "11:30",
      "suggestion": "Deep work: Fix auth bug (PROJ-42)",
      "project": "Project Alpha"
    }
  ],
  "needsResponse": [
    {
      "source": "slack",
      "from": "@alice",
      "summary": "Can you review the PR?",
      "age": "2h",
      "url": "..."
    }
  ]
}
```

## Instructions

### Step 1: Aggregate All Tasks

Collect all `myTasks` from every project snapshot into a single list. For each task, preserve the originating project title.

### Step 2: Rank by Urgency

Apply this priority hierarchy (highest to lowest):

1. **Overdue tasks**: Due date is before today — these are the most urgent
2. **Today's deadlines**: Due date is today — must be completed or progressed
3. **Blockers**: Items marked as blocked that the user can unblock — clearing blockers multiplies team productivity
4. **Meetings requiring preparation**: Meetings starting within 4 hours that need prep work
5. **Items needing response**: Unanswered Slack messages, emails, PR reviews — time-sensitive communication
6. **In-progress tasks**: Tasks already started (status "In Progress") — maintain momentum
7. **High-priority upcoming**: High/Critical priority tasks due this week
8. **Routine work**: Medium/Low priority tasks, general follow-ups

Within the same urgency tier, prioritize by:
- Project role: `active` projects before `informed` projects
- Task priority: Critical > High > Medium > Low
- Recency: More recently updated items first

### Step 3: Identify Conflicts

Scan for these conflict types:

**Meeting overlaps:**
- Compare all meetings across projects by start/end times
- Flag any overlaps and suggest which to keep based on project priority and meeting importance

**Competing deadlines:**
- Multiple tasks due today or overdue across different projects
- Estimate if there's enough time to address all of them
- Suggest which to prioritize and which to defer or delegate

**Context-switching risk:**
- If tasks from 3+ different projects are all urgent, flag the context-switching cost
- Suggest batching related tasks together

### Step 4: Suggest Focus Blocks

Analyze today's calendar to find gaps for deep work:

1. Map all meetings from all project snapshots onto a timeline
2. Identify gaps of 1 hour or more between meetings
3. Assign the highest-priority tasks to the largest gaps
4. Prefer placing complex/creative tasks in morning blocks
5. Place communication tasks (email replies, Slack responses) in short gaps or after meetings

Output suggested time blocks:

```
09:00-09:30  Daily Standup (Project Alpha)
09:30-11:30  [FOCUS] Fix auth bug PROJ-42 (Project Alpha) — 2h block
11:30-12:00  [COMMS] Reply to Slack messages, review PR
12:00-13:00  Lunch
13:00-14:00  [FOCUS] API integration BETA-15 (Project Beta) — 1h block
14:00-15:00  Sprint Review (Project Alpha)
15:00-16:30  [FOCUS] Continue BETA-15 or handle overflow
16:30-17:00  [COMMS] Email responses, EOD updates
```

### Step 5: Surface Items Needing Response

Scan all project snapshots for:
- Slack messages with questions or requests directed at the user
- Emails in the `to` field (not just `cc`) that haven't been replied to
- PR review requests
- Jira comments asking for input

Rank by age (oldest unanswered first) and importance (direct questions > FYI messages).

### Step 6: Compile Output

Assemble the final structure with:

- **priorities**: Ranked list of all actions with category, reason, and links
- **conflicts**: Any scheduling or deadline conflicts with resolution suggestions
- **focusBlocks**: Suggested time blocks for the day
- **needsResponse**: Items requiring the user's reply, ranked by urgency
- **informedProjectSummary**: Brief 1-2 line summaries for `informed` projects (what changed, if anything)

### Capacity Check

Before finalizing, estimate total work hours needed vs. available hours:
- Sum estimated effort for all urgent/important tasks
- Compare against available focus time (total hours minus meetings)
- If overloaded: explicitly flag it, suggest what to defer, and recommend communicating delays on lower-priority items

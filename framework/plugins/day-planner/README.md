# Day Planner

Use AI-driven analysis of collector data to plan the day across all tracked projects, prioritizing actions and surfacing conflicts.

## Purpose

Acts as a personal day-planning assistant that queries the collector service for each tracked project, builds per-project status snapshots in parallel, then synthesizes a cross-project daily plan. Surfaces what to work on, when, and why — accounting for deadlines, blockers, meetings, and role-based attention levels.

## Capabilities

- **Daily Plan**: Comprehensive day plan with prioritized actions across all active projects
- **Role-Aware Filtering**: Adjusts data depth based on project role (`active` = full detail, `informed` = key changes, `muted` = skip)
- **Conflict Detection**: Identifies overlapping meetings, competing deadlines, and resource conflicts
- **Focus Blocks**: Suggests time blocks for deep work based on calendar gaps and task urgency

## Commands

| Command | Description |
|---------|-------------|
| `/plan_day` | Generate today's daily plan. Executes `skills/project_status` in parallel for each active project, then feeds all results into `skills/daily_priorities` for cross-project synthesis. |

## When to Use

Use this plugin when:
- User asks "What should I work on today?" or "Plan my day"
- User wants to prioritize across multiple projects
- User asks "What's most urgent?" or "Where should I focus?"
- User requests a daily plan or work prioritization
- User asks "Do I have any conflicts today?"

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `projects` | No | List of project objects from the Projects API (default: all projects with status `active` or `paused`) |
| `date` | No | Target date for the plan (default: today) |

## Outputs

- Structured daily plan in Markdown with prioritized actions, time blocks, and conflicts
- Per-project status snapshots feeding into the plan
- Ranked priority list with suggested next actions

## Dependencies

- **Tools**: `collector`, `time`
- **APIs**: Projects API (`/api/v1/projects`) for project list and metadata
- **Other Plugins**: None

---

## Instructions

### Pre-Execution

1. Read `brain/guidelines.md` for output standards
2. Read `tools/collector/TOOL.md` to understand the collector API
3. Read `tools/time/TOOL.md` to get the current date/time
4. **Get current date/time first** — this is critical for constructing all date-based queries

### Command: `/plan_day`

#### Step 1: Get Projects

Fetch tracked projects from the Projects API:

```bash
curl -X GET "${COLLECTOR_API_URL}/projects" \
  -H "x-api-key: ${COLLECTOR_API_KEY}"
```

Filter to projects where `status` is `active` or `paused`. Skip projects with `myRole: "muted"`.

#### Step 2: Execute `skills/project_status` in Parallel

For each non-muted project, execute `skills/project_status` concurrently. Each invocation receives:
- The project object (title, sources, role, goals)
- The current date/time from Step 1

All project status calls are independent and can run in parallel.

#### Step 3: Execute `skills/daily_priorities`

Once all project status snapshots are collected, feed them into `skills/daily_priorities` for cross-project synthesis. This skill:
- Ranks actions by urgency across all projects
- Detects conflicts (overlapping meetings, competing deadlines)
- Suggests focus blocks and time allocation
- Surfaces unanswered messages needing response

#### Step 4: Compile Daily Plan

Assemble the final output:

```markdown
# Daily Plan — [Day, Month Date, Year]

## Focus Areas
[Top 3 priorities for the day, derived from daily_priorities]

## Schedule & Time Blocks
| Time | Activity | Project |
|------|----------|---------|
| 09:00-09:30 | Daily Standup | Project Alpha |
| 09:30-11:30 | Deep Work: Fix auth bug (PROJ-42) | Project Alpha |
| 11:30-12:00 | Review PR comments | Project Beta |
| 14:00-15:00 | Sprint Review | Project Alpha |
| 15:00-16:30 | Deep Work: API integration | Project Beta |

## Priority Actions
### Urgent (Do Today)
- [ ] **[PROJ-42] Fix login bug** — overdue, High priority [-> link]
- [ ] Reply to @alice in #engineering about deployment [-> link]

### Important (Progress Today)
- [ ] **[BETA-15] API integration** — due tomorrow [-> link]
- [ ] Review Q4 planning doc shared by @bob [-> link]

### Monitor (Stay Informed)
- Project Gamma: Sprint started, no action needed
- Project Delta: Key decision pending in #delta-channel

## Conflicts & Risks
- 14:00: Sprint Review overlaps with Project Beta sync — recommend declining Beta sync
- PROJ-42 and BETA-15 both need attention today — prioritize PROJ-42 (overdue)

## Needs Response
- Email from bob@co.com: "Q4 Report Draft" (5h ago) [-> link]
- Slack DM from @carol: "Can you review the PR?" (2h ago) [-> link]

## Project Snapshots
[Collapsed/summary view of each project's status from project_status skill]
```

---

### Post-Execution

1. Present the plan in clean, scannable Markdown
2. Lead with the most actionable items — focus areas first
3. Include links (URLs) to original items where available
4. Keep the plan realistic — flag if there are more tasks than hours available
5. Highlight anything that needs an immediate response

### Error Handling

- **Collector unreachable**: Report the error and suggest running the plan once the collector is available. Do not produce a partial plan without data.
- **Projects API unavailable**: Fall back to a general daily digest (delegate to `daily-digest` plugin) and note that project-specific planning is unavailable.
- **No results for a project**: Include the project in the plan with a note that no recent activity was found — it may need a sync.
- **Stale data**: Check index status; if a source hasn't synced in >24h, note it next to affected items.
- **Single project failure**: Continue with remaining projects and note which project's data could not be retrieved.

# Weekly Review

Generate comprehensive weekly summaries and accomplishment reports from all indexed data.

## Purpose

Produces end-of-week summaries covering everything that happened: meetings attended, tasks completed, emails processed, documents created, code merged, and conversations had. Also extracts accomplishments for standups, manager check-ins, and performance reviews.

## Capabilities

- **Week Summary**: Full weekly activity report across all connectors
- **Accomplishments**: Extract concrete accomplishments for reporting and reviews

## Commands

| Command | Description |
|---------|-------------|
| `/weekly` | Generate this week's review. Invokes `skills/week_summary` and `skills/accomplishments` in parallel, then combines. |

## When to Use

Use this plugin when:
- User asks for a weekly summary or review
- User wants to know what they accomplished this week
- User needs to prepare for a standup or retrospective
- User asks "What did I do this week?"
- User wants to generate a status update for their manager
- User asks for accomplishments for a performance review period

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `week_start` | No | Start of the week (default: last Sunday or Monday) |
| `week_end` | No | End of the week (default: today) |
| `format` | No | `full` (comprehensive, default), `brief` (highlights only), `standup` (standup format) |

## Outputs

- Comprehensive weekly review in Markdown
- Extracted accomplishments list
- Activity metrics per source

## Dependencies

- **Tools**: `collector`, `time`
- **Other Plugins**: None

---

## Instructions

### Pre-Execution

1. Read `brain/guidelines.md` for output standards
2. Read `tools/collector/TOOL.md` to understand the collector API
3. Read `tools/time/TOOL.md` to get the current date/time
4. **Get current date/time** — calculate the week's date range (Sunday to Saturday or Monday to Friday based on preference)

### Command: `/weekly`

Execute `skills/week_summary` and `skills/accomplishments` in parallel, then combine into a unified weekly review.

**Output format:**

```markdown
# Weekly Review — [Week Date Range]

## 📊 Week at a Glance
[Key metrics: meetings, tasks completed, PRs merged, etc.]

## 📋 Summary
[Narrative summary from week_summary skill]

## 🏆 Accomplishments
[From accomplishments skill]

## 📅 Next Week Preview
[Upcoming items for next week]
```

---

### Post-Execution

1. Present the review in clean, professional format
2. Lead with accomplishments (most useful for the user)
3. Include activity metrics for context
4. Suggest items to carry over to next week

### Error Handling

- **Incomplete data**: Note which sources had limited data; generate report from available sources
- **No activity in a source**: Omit that section rather than showing empty data
- **Week not yet complete**: Note the report covers through today and may be incomplete

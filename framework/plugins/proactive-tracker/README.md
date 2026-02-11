# Proactive Tracker

Proactively monitor indexed data for items needing attention: stale work, missed follow-ups, approaching deadlines, and comprehensive context building.

## Purpose

Acts as a watchdog that scans all indexed data to surface items that might fall through the cracks. Identifies stale tasks, unanswered messages, approaching deadlines, and builds comprehensive context briefs for any topic.

## Capabilities

- **Stale Item Detection**: Find items that haven't been updated in a configurable time
- **Follow-Up Tracking**: Detect messages and emails that were sent but never got a response
- **Deadline Watching**: Track approaching deadlines from all sources
- **Context Building**: Build comprehensive context briefs by combining data from all connectors

## Commands

| Command | Description |
|---------|-------------|
| `/check` | Check for items needing attention. Invokes `skills/stale_items`, `skills/follow_up_needed`, and `skills/deadline_watch` in parallel. |
| `/stale` | Show stale/forgotten items. Invokes `skills/stale_items` with default thresholds. |

## When to Use

Use this plugin when:
- User asks "Am I forgetting anything?" or "What's falling through the cracks?"
- User wants to check for stale or abandoned work
- User asks "What follow-ups do I need to do?"
- User wants to see upcoming deadlines across all sources
- User asks for a comprehensive context brief on a topic (use `skills/context_builder`)
- User says "Catch me up on [topic]" or "What do I need to know about [topic]?"

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `stale_threshold_days` | No | Days without update to consider stale (default: 14) |
| `topic` | For context_builder | Topic/project name for context building |
| `sources` | No | Limit to specific sources (default: all) |

## Outputs

- Categorized list of items needing attention
- Follow-up tracking report
- Deadline timeline
- Comprehensive context briefs

## Dependencies

- **Tools**: `collector`, `time`
- **Other Plugins**: None

---

## Instructions

### Pre-Execution

1. Read `brain/guidelines.md` for output standards
2. Read `tools/collector/TOOL.md` to understand the collector API
3. Read `tools/time/TOOL.md` to get the current date/time
4. **Get current date/time first** — critical for all staleness and deadline calculations

### Command: `/check`

Execute `skills/stale_items`, `skills/follow_up_needed`, and `skills/deadline_watch` in parallel, then combine results into a unified attention report.

**Output format:**

```markdown
# Attention Report — [Date]

## 🕐 Upcoming Deadlines (X items)
[From deadline_watch]

## 📬 Follow-Ups Needed (X items)
[From follow_up_needed]

## 🕸️ Stale Items (X items)
[From stale_items]

## Suggested Actions
[Top 3-5 most impactful things to address]
```

### Command: `/stale`

Execute `skills/stale_items` with default thresholds.

### Context Requests

When user asks to be caught up on a topic, execute `skills/context_builder` with the topic.

---

### Post-Execution

1. Present findings in clean, scannable format
2. Lead with the most urgent items
3. Include links to all referenced items
4. Suggest concrete next steps for addressing each finding

### Error Handling

- **Collector unreachable**: Report partial results from available sources
- **No stale items found**: Report that everything appears healthy
- **No follow-ups needed**: Report all conversations appear resolved

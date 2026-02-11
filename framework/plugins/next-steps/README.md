# Next Steps

Analyze indexed data to suggest what to work on next and provide project status reports.

## Purpose

Acts as a productivity advisor by analyzing open tasks, pending messages, upcoming deadlines, and recent activity across all connectors. Synthesizes this data to recommend the most impactful next actions and provide holistic project status views.

## Capabilities

- **Next Action Suggestions**: Analyzes all pending work and recommends top 5 actions with reasoning
- **Project Status Reports**: Cross-connector search to synthesize the current state of any project or topic
- **Priority Queue**: Builds a ranked queue of all pending items from all sources

## Commands

| Command | Description |
|---------|-------------|
| `/next` | What should I do next? Invokes `skills/suggest_next_actions` to analyze pending work and suggest top actions. |
| `/project_status [project]` | Get the status of a specific project or topic. Invokes `skills/project_status` with the project name. |

## When to Use

Use this plugin when:
- User asks "What should I do next?" or "What's most important?"
- User wants to know the status of a specific project
- User asks "What's my priority right now?"
- User wants to see all their pending work in one place
- User asks "Am I forgetting anything?"

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `project` | For `/project_status` | Project name, topic, or keyword to search |
| `max_suggestions` | No | Max number of suggestions for `/next` (default: 5) |
| `sources` | No | Limit to specific sources (default: all) |

## Outputs

- Ranked list of suggested next actions with reasoning
- Comprehensive project status report
- Prioritized queue of all pending items

## Dependencies

- **Tools**: `collector`, `time`
- **Other Plugins**: None

---

## Instructions

### Pre-Execution

1. Read `brain/guidelines.md` for output standards
2. Read `tools/collector/TOOL.md` to understand the collector API
3. Read `tools/time/TOOL.md` to get the current date/time
4. **Get current date/time first** — essential for priority calculations

### Command: `/next`

Execute `skills/suggest_next_actions` and present the top suggestions.

### Command: `/project_status [project]`

Execute `skills/project_status` with the provided project name.

### Standalone Use

For a full priority queue, execute `skills/priority_queue`.

---

### Post-Execution

1. Present suggestions or status in clear, actionable format
2. Include direct links to items where available
3. Explain the reasoning behind priority rankings
4. Offer to drill deeper into any specific item

### Error Handling

- **No pending items found**: Report that everything appears caught up; suggest checking if data is recent (index status)
- **Collector unreachable**: Report which sources failed; show partial results
- **Ambiguous project name**: Show matching results and ask user to clarify which project they mean

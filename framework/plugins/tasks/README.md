# Tasks

Manage scheduled tasks stored in a NocoDB database. These tasks are prompts that will be executed by an LLM plugin at their scheduled time, with support for recurring schedules.

## Purpose

Provides a natural language interface for managing scheduled tasks. An external workflow fetches pending tasks when `execute_at` time is reached and passes the content as a prompt to the assistant—this plugin focuses solely on CRUD operations.

## Capabilities

- Create tasks with content (prompt) and scheduled execution time
- Create recurring tasks using cron expressions (plugin translates natural language to cron)
- List tasks with human-readable recurrence descriptions
- Update existing tasks (reschedule, modify content, modify recurrence)
- Delete tasks
- Parse natural language dates into ISO 8601 format

## Commands

| Command | Description |
|---------|-------------|
| `/agenda` | Lists all tasks scheduled for today. Invokes `skills/manage_tasks` with `action: list` and appropriate filters for the current day. |

## When to Use

Use this plugin when:
- User wants to schedule a task for the AI to execute later
- User wants to schedule a recurring task
- User asks to see their upcoming/pending tasks
- User wants to modify or cancel an existing task

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `action` | Yes | One of: `create`, `list`, `update`, `delete` |
| `content` | For create | The task prompt (what the AI should do) |
| `execute_at` | For create | When to execute (natural language or ISO 8601) |
| `recurrence` | No | Recurrence pattern in natural language (stored as cron) |
| `recurrence_end` | No | When to stop recurring (natural language or ISO 8601) |
| `id` | For update/delete | The task ID to modify |
| `filter` | For list | Filter criteria (date range, executed status) |

## Outputs

- Confirmation messages for create/update/delete
- Formatted list of tasks for list action (with human-readable recurrence)
- Errors if operations fail

## Dependencies

- **Tools**: `nocodb`, `time`, `timezone`
- **Other Plugins**: None

---

## Instructions

> [!CAUTION]
> **YOU MUST STORE ALL TIMES IN UTC.**
> The `execute_at` field and any recurrence cron expressions **MUST** be converted to UTC before storage. Storing times in the user's local timezone (IST) is a **CRITICAL FAILURE**.

### Pre-Execution

1. Read `brain/guidelines.md` for output standards
2. Read `tools/nocodb/TOOL.md` to understand database operations
3. Read `tools/time/TOOL.md` for getting current time (essential for relative times)
4. Read `tools/timezone/TOOL.md` for timezone conversion (**user input is Israel time, storage is UTC, including the cron expression for recurrence**)
5. Verify environment variables are available:
   - `TASKS_NOCODB_HOST`
   - `TASKS_NOCODB_API_TOKEN`
   - `TASKS_NOCODB_WORKSPACE`
   - `TASKS_NOCODB_BASE_ID`
   - `TASKS_NOCODB_TABLE_ID`

### Table Schema

| Column | Type | Description |
|--------|------|-------------|
| `content` | string | Task prompt to pass to the AI plugin |
| `execute_at` | datetime | When to execute the task (ISO 8601 UTC) |
| `executed` | boolean | Whether task was executed (default: false) |
| `recurrence` | string | Cron expression (null for one-time) |
| `recurrence_end` | datetime | When to stop recurring (null = forever) |

---

### Cron Expression Reference

The `recurrence` field stores cron expressions (5 fields: minute, hour, day-of-month, month, day-of-week).

> [!IMPORTANT]
> **All cron expressions MUST be stored in UTC.**
> When the user provides a time (e.g., "9am"), you must convert this from Israel time (user's local time) to UTC BEFORE generating the cron expression.

**Natural Language → Cron Translation (Example for UTC+2 Israel time):**

| User Says | Calculation | Cron Expression (UTC) |
|-----------|-------------|-----------------------|
| "every day at 9am" | 9am IST → 7am UTC | `0 7 * * *` |
| "every day at 9:30am" | 9:30am IST → 7:30am UTC | `30 7 * * *` |
| "every Monday at 9am" | 9 Monday IST → 7 Monday UTC | `0 7 * * 1` |
| "every weekday at 9am" | 9am IST → 7am UTC | `0 7 * * 1-5` |
| "every weekend at 10am" | 10am IST → 8am UTC | `0 8 * * 0,6` |
| "every month on the 1st at 9am" | 9am IST → 7am UTC | `0 7 1 * *` |
| "every month on the 15th at 3pm" | 3pm IST → 1pm UTC | `0 13 15 * *` |
| "every year on Jan 1st at midnight" | 12am IST → 10pm (prev day) UTC | `0 22 31 12 *` |
| "every hour" | N/A | `0 * * * *` |
| "every 30 minutes" | N/A | `*/30 * * * *` |

**Cron → Human-Readable Translation (convert UTC back to Israel time for display):**

| Cron Expression (UTC) | Display As (Israel Time) |
|-----------------------|--------------------------|
| `0 7 * * *` | "Daily at 9:00 AM" |
| `0 7 * * 1` | "Every Monday at 9:00 AM" |
| `0 7 * * 1-5` | "Weekdays at 9:00 AM" |
| `0 7 1 * *` | "Monthly on the 1st at 9:00 AM" |

### Scheduling Logic (Natural Language Times)

When the user provides a natural language time (e.g., "at 9am") without a specific date:
1.  Convert the time to **UTC**.
2.  Compare the target UTC time with the **current UTC time**.
3.  **If the target UTC time has NOT passed yet today**, schedule for **today**.
4.  **If the target UTC time HAS already passed today**, schedule for **tomorrow**.

> [!TIP]
> Tasks should generally end today if possible. Only start from tomorrow if the requested hour in UTC has already passed for the current day.

**Example (Current UTC: 2026-02-07 08:30:00):**
- User says "at 9am IST" (7am UTC): 7am UTC has passed -> Schedule for **2026-02-08 07:00:00 UTC**.
- User says "at 12pm IST" (10am UTC): 10am UTC has not passed -> Schedule for **2026-02-07 10:00:00 UTC**.

---

### Action: Manage Tasks (Create/List/Update/Delete)
Use `skills/manage_tasks` with the appropriate `action` parameter.

### Action: Plan Complex Project
Use `skills/break_down_project` to automatically generate and schedule sub-tasks for a large goal.

---

### Post-Execution

1. Summarize what was done
2. For create/update, show the scheduled time and recurrence in human-readable format
3. Suggest related actions (e.g., "Want to schedule another task?")

### Error Handling

- **Auth failure (401/403)**: Check `TASKS_NOCODB_API_TOKEN` is valid
- **Not found (404)**: Verify table ID and base ID are correct
- **Invalid date**: Ask user to clarify the time they want
- **Invalid recurrence**: Ask user to clarify the pattern
- **Duplicate content**: Warn user about similar existing task
- **Connection error**: Report NocoDB host may be unreachable

# Manage Tasks

Create, list, update, and delete tasks.

## Purpose

Unified interface for all task management operations.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `action` | Yes | `create`, `list`, `update`, `delete` |
| `content` | No | Task prompt (required for `create`) |
| `execute_at` | No | Schedule time (for `create`, `update`) |
| `id` | No | Task ID (for `update`, `delete`) |
| `recurrence` | No | Recurrence pattern |

## Instructions

### Step 1: Parse Action

> [!CAUTION]
> **NEVER STORE LOCAL TIME.**
> You MUST convert all user-provided times to **UTC** before calling NocoDB. Storing times in the user's local timezone is a critical failure.

Handle valid actions:
1. **create**: Requires `content` and `execute_at`.
   - Convert `execute_at` time to **UTC** (ISO 8601 format).
     - **Scheduling Logic**: If current UTC time is before the target UTC time, schedule for **today**. Otherwise, schedule for **tomorrow**.
   - Convert `recurrence` (natural language) to a cron expression in **UTC** (based on Israel time).
   - POST to NocoDB.
2. **list**: Optional `filter`.
   - GET from NocoDB.
   - Format output table.
3. **update**: Requires `id`.
   - PATCH to NocoDB.
4. **delete**: Requires `id`.
   - DELETE from NocoDB.

### Step 2: Confirmation

Return the result of the operation in human-readable format.

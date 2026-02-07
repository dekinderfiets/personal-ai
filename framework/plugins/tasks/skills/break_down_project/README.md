# Break Down Project

Deconstruct a large goal into manageable sub-tasks.

## Purpose

Uses LLM reasoning to split a complex objective (e.g., "Plan a vacation") into concrete, scheduled steps.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `project_goal` | Yes | The high-level objective |
| `start_date` | No | When to begin (default: today) |
| `deadline` | No | When to finish |

## Instructions

### Step 1: Decompose Goal

Analyze the `project_goal` and generate a list of 5-10 actionable steps.
- Ensure logical order (dependency chain).
- Estimate time required for each.

### Step 2: Schedule

Assign dates to each step, spreading them out between `start_date` and `deadline`.
- Avoid weekends if requested.
- Ensure realistic pacing.

### Step 3: Create Tasks

Loop through the generated steps and call `skills/manage_tasks` (action: create) for each one.

### Step 4: Report

Output the created project plan with all scheduled sub-tasks.

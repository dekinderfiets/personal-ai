# Plugins Directory

This directory contains autonomous plugins, each defined as markdown instructions for the AI to follow.

## Structure

Each plugin lives in its own subdirectory with a single `README.md` file:

```
plugins/
├── {plugin-name}/
│   ├── README.md       # Plugin description, capabilities, and instructions
│   └── skills/         # (Optional) Plugin-specific skills
│       └── {skill}/
│           └── SKILL.md
```

## Creating a New Plugin

1. Create a new directory with the plugin's name (use kebab-case)
2. Add `README.md` containing everything the orchestrator needs:
   - Purpose and capabilities
   - When to use
   - Inputs/Outputs
   - Dependencies
   - Step-by-step instructions
   - Error handling

## README.md Template

```markdown
# Plugin Name

Brief description.

## Purpose

What this plugin does.

## Capabilities

- Capability 1
- Capability 2

## When to Use

Use this plugin when:
- Condition 1
- Condition 2

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `input1` | Yes | Description |

## Outputs

- Where outputs are written

## Dependencies

- **Tools**: tool1, tool2
- **Other Plugins**: plugin1

---

## Instructions

### Pre-Execution

1. Setup step 1
2. Setup step 2

### Step 1: First Action

Detailed instructions...

### Step 2: Next Action

Detailed instructions...

### Post-Execution

1. Cleanup / reporting

### Error Handling

- **Error case**: How to handle it
```

## Discovery

The orchestrator discovers plugins by:
1. Listing subdirectories in `plugins/`
2. Reading each plugin's `README.md`
3. Matching capabilities to the requested task
4. Following the instructions section to execute

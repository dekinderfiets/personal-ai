# Corrections

Store and manage user corrections to avoid repeating the same mistakes.

## Purpose

When users correct the agent ("no, I meant...", "you're wrong, it should be..."), this plugin stores those corrections for future reference. This prevents the agent from making the same mistakes repeatedly.

## Capabilities

- Store new corrections with appropriate context
- List all stored corrections (command: `/corrections`)
- Update existing corrections
- Delete outdated corrections
- Filter corrections by domain

## When to Use

Use this plugin when:
- User provides feedback like "no, I meant...", "actually...", "you're wrong..."
- User explicitly asks to see their corrections
- User wants to update or delete a correction
- Before responding in a domain where corrections exist (check first!)

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `action` | Yes | One of: `create`, `list`, `update`, `delete` |
| `domain` | No | Category for the correction (e.g., `finance`, `general`) |
| `when` | For create | When this correction applies |
| `correction` | For create | The correct interpretation |
| `index` | For update/delete | The correction index to modify |

## Outputs

- Confirmation messages for create/update/delete
- Formatted list of corrections for list action
- Errors if operations fail

## Dependencies

- **Tools**: None (file-based storage)
- **Other Plugins**: None

---

## Storage

Corrections are stored as **one markdown file per domain** in `context/corrections/`:

```
context/corrections/
├── general.md
├── finance.md
└── ...
```

Each file contains multiple numbered corrections.

---

## Instructions

### Pre-Execution

1. Read `brain/guidelines.md` for output standards
2. Scan `context/corrections/` for existing corrections

### Writing Good Corrections

> [!IMPORTANT]
> Corrections must be **generalizable but specific enough to be useful**.

**❌ Too specific** (won't help in similar situations):
- "The user meant the 15th"
- "The file is in the Downloads folder"

**✅ Well-balanced** (captures the pattern):
- "In financial context, 'end of month' means the 15th of the next billing month"
- "When user mentions 'the usual folder', they mean ~/Documents/Projects"

**❌ Too vague** (prone to misapplication):
- "Be careful with dates"
- "Double-check file paths"

### Action: Manage Corrections
Use `skills/manage_corrections` with the appropriate `action` parameter.

### Post-Execution

1. Summarize what was done
2. For create, confirm the correction was stored
3. Suggest reviewing related corrections if applicable

### Error Handling

- **Index not found**: Correction index doesn't exist in the domain file
- **Domain file not found**: No corrections exist for that domain yet
- **Duplicate detected**: Warn about similar existing correction

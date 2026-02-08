# Manage Corrections

Create, list, update, and delete corrections.

## Purpose

Unified interface for all correction management operations.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `action` | Yes | `create`, `list`, `update`, `delete` |
| `domain` | No | Category (default: `general`) |
| `when` | For create | Context when correction applies |
| `correction` | For create | The correct interpretation |
| `index` | For update/delete | The index (1-based) of correction to modify |

## Storage Format

All corrections are stored in a **single file per domain**:
- `context/corrections/general.md` - General corrections
- `context/corrections/finance.md` - Finance-related corrections
- etc.

Each file contains multiple corrections in this format:

```markdown
# Corrections: {domain}

## 1. {short title}
**When**: {context when this applies}
**Correct interpretation**: {what the user actually means}

## 2. {short title}
**When**: {context when this applies}
**Correct interpretation**: {what the user actually means}
```

## Instructions

### Step 1: Parse Action

Handle valid actions:

1. **create**: Requires `domain`, `when`, and `correction`.
   - Open or create `context/corrections/{domain}.md`
   - Append new correction with next index number
   - Add a short descriptive title based on the correction

2. **list**: Optional `domain` filter.
   - Read all `.md` files in `context/corrections/`
   - Format as table:
   ```
   | Domain | # | When | Correction |
   |--------|---|------|------------|
   | finance | 1 | "end of month" | 15th of next billing month |
   | general | 1 | "the usual folder" | ~/Documents/Projects |
   ```
   - If `domain` provided, filter to that file only

3. **update**: Requires `domain`, `index`, and updated fields.
   - Read `context/corrections/{domain}.md`
   - Find correction by index
   - Update specified fields
   - Write back

4. **delete**: Requires `domain` and `index`.
   - Read `context/corrections/{domain}.md`
   - Remove the correction at that index
   - Renumber remaining corrections
   - Write back

### Step 2: Confirmation

Return the result of the operation in human-readable format.

For **create**, show:
- The domain and index
- Summary of what was stored

For **list**, show:
- Table of corrections grouped by domain
- Count of total corrections

For **update**, show:
- What was changed
- New values

For **delete**, show:
- Confirmation of deletion
- Reminder that this is permanent

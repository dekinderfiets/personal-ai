# Tools Directory

Reusable capabilities, templates, and procedural knowledge that plugins can apply.

## Structure

```
tools/
├── {tool-name}/
│   ├── TOOL.md      # Tool description, instructions, and templates
│   └── scripts/     # Optional: executable scripts, CLI tools, wrappers
```

## What is a Tool?

A tool is a **self-contained capability** that encapsulates everything needed to perform a task:
- **Knowledge**: Procedures, workflows, best practices, domain expertise
- **Scripts**: CLI utilities, API wrappers (when needed)
- **Templates**: Formats and boilerplate for consistent outputs

Tools bundle both the "how to" knowledge and any executable code together.

## Creating a Tool

1. Create a directory with the tool name (kebab-case)
2. Add `TOOL.md` containing instructions and knowledge
3. Add a `scripts/` subdirectory for any executable tools (optional)

## TOOL.md Template

```markdown
# Tool Name

Brief description of the tool.

## Purpose

What this tool enables.

## When to Use

Apply this tool when:
- Condition 1
- Condition 2

## Prerequisites

What's needed to use this tool.

---

## Instructions

Step-by-step instructions for applying this tool.

### Step 1: First Action

Details...

### Step 2: Next Action

Details...

---

## Scripts (if applicable)

If this tool includes executable scripts, document them here:
- `scripts/tool-name.py` - What it does
- `scripts/helper.sh` - What it does

---

## Template (if applicable)

Any boilerplate or template content goes here.
```

## Discovery

Plugins discover tools by scanning this directory and reading `TOOL.md` files to match capabilities to tasks.

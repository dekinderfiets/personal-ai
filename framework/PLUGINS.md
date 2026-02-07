# AI Plugin Framework

You are an **orchestrator** for a multi-plugin AI system. Your role is to understand user goals, delegate work to specialized plugins, and coordinate their execution.

## Your Role as Orchestrator

1. **Read this file first** - Understand the system architecture
2. **Analyze the user's request** - Determine what needs to be accomplished
3. **Discover available plugins** - Scan `plugins/` to find suitable plugins for the task
4. **Delegate and coordinate** - Use plugins (as sub-agents when possible for parallelism)
5. **Synthesize results** - Combine outputs into a coherent response

**Important**: You should NOT directly modify files in `tools/` or `context/`. Those are managed by the plugins you invoke. Your job is orchestration only.

---

## System Architecture

### Directory Structure

| Directory | Purpose | Access |
|-----------|---------|--------|
| `plugins/` | Autonomous plugins with specific capabilities | Orchestrator discovers, plugins execute |
| `brain/` | Core knowledge, guidelines, shared concepts | Read by all plugins |
| `context/` | Datasets, references, external data | Read by plugins as needed |
| `tools/` | **Global** reusable capabilities, scripts, and templates | Used by all plugins |


---

## How to Discover Plugins

Scan the `plugins/` directory. Each subdirectory is a plugin. Read the plugin's `README.md` to understand:
- What the plugin does
- When to use it
- Required inputs
- Expected outputs
- Step-by-step instructions

Plugins may also contain a `skills/` subdirectory for internal capabilities:

```
plugins/
├── {plugin-name}/
│   ├── README.md       # Plugin description
│   └── skills/         # Plugin-specific skills
│       └── {skill}/
│           └── SKILL.md
```

**Plugin Selection Process**:
1. List all directories in `plugins/`
2. Read each plugin's `README.md`
3. Match plugin capabilities to the user's request
4. Follow the instructions section to execute the plugin

---

## How to Discover Tools

Tools are **global**, reusable capabilities. Scan `tools/` directory:

```
tools/
├── {tool-name}/
│   ├── TOOL.md      # Tool description, instructions, and templates
│   └── scripts/     # Optional: executable scripts, CLI tools, wrappers
```

Each tool is self-contained with its TOOL.md and any scripts it needs.

---

## Shared Knowledge (Brain)

The `brain/` directory contains knowledge all plugins should be aware of:
- `concepts.md` - Core concepts and terminology
- `guidelines.md` - Behavioral guidelines and best practices
- `instructions.md` - Cross-plugin instructions

Plugins should read relevant brain files before executing tasks.

---



## Execution Patterns

### Sequential Execution
For tasks with dependencies:
```
1. Plugin A produces output
2. Plugin B uses A's output
3. Plugin C synthesizes final result
```

### Parallel Execution
For independent subtasks, spawn multiple plugins simultaneously:
```
┌─ Plugin A (subtask 1) ─┐
│                        │
├─ Plugin B (subtask 2) ─┼─► Orchestrator combines results
│                        │
└─ Plugin C (subtask 3) ─┘
```

### Hybrid Execution
Combine patterns as needed for complex workflows.

---

## Guidelines for Orchestration

1. **Minimal intervention** - Let plugins handle their domains
2. **Clear delegation** - Provide plugins with specific, actionable tasks
3. **Context passing** - Pass relevant context between plugins
4. **Error handling** - If a plugin fails, determine if retry, fallback, or escalation is needed
5. **Result synthesis** - Combine plugin outputs into a coherent response for the user

---

## Quick Start

When you receive a user request:

1. **Understand** - What is the user trying to achieve?
2. **Discover** - What plugins and tools are available? (scan directories)
3. **Plan** - Which plugins should handle which parts?
4. **Execute** - Spawn plugins (parallel when possible)
5. **Synthesize** - Combine results and respond to user

---

## Notes

- This file is the **single entry point** for orchestrators
- Plugin and tool discovery is **dynamic** - no hardcoded lists to maintain
- Each component is **self-documenting** via its own README/TOOL/PLUGIN.md
- The system is **extensible** - add new plugins or tools without updating this file

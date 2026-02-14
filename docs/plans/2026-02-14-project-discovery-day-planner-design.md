# Project Discovery & Day Planner — Design Document

**Date:** 2026-02-14
**Status:** Approved

## Overview

A system for discovering and tracking projects across all indexed sources (Jira, Slack, Gmail, Drive, Confluence, Calendar, GitHub), with a human-in-the-loop review process and a framework plugin for daily planning.

## Components

### 1. Collector MCP Server (`collector/mcp-server/`)

A stdio-based Node.js MCP server bundled with the collector service. Spawned by the code-agent via a repo-level `.cursor/mcp.json` in the temp workspace.

**Read tools:**

| Tool | Description | Parameters |
|------|-------------|------------|
| `search` | Search across all indexed sources | `query`, `sources?`, `searchType?`, `startDate?`, `endDate?`, `limit?` |
| `get_index_status` | Check what's indexed and how fresh | none |
| `get_document` | Fetch a single document by ID | `id` |
| `list_projects` | Get existing discovered projects | `status?` |
| `get_project` | Get full details of one project | `projectId` |

**Write tools:**

| Tool | Description | Parameters |
|------|-------------|------------|
| `propose_new_project` | Propose a newly discovered project | `sessionId`, `title`, `description`, `goals`, `status`, `participants`, `sources`, `tags`, `metadata`, `reason` |
| `propose_project_update` | Propose a change to an existing project field | `sessionId`, `projectId`, `field`, `newValue`, `reason` |

**MCP config** (written to temp workspace at `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "collector": {
      "command": "node",
      "args": ["/path/to/collector/mcp-server/index.js"],
      "env": {
        "COLLECTOR_API_URL": "http://collector:8087/api/v1",
        "COLLECTOR_API_KEY": "<key>"
      }
    }
  }
}
```

### 2. Data Model

**Project entity** (PostgreSQL):

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Primary key |
| `title` | string | Project name |
| `description` | text | What this project is about |
| `goals` | text[] | Key objectives |
| `status` | enum | `active`, `paused`, `completed`, `archived` |
| `myRole` | enum | `active` (hands-on), `informed` (oversight), `muted` (no updates) |
| `participants` | jsonb | People involved (name, role, source) |
| `sources` | jsonb | Linked sources — Jira project keys, Slack channels, GitHub repos, Drive folders, etc. |
| `tags` | string[] | User-defined labels |
| `metadata` | jsonb | Flexible extra fields (priority, deadlines, etc.) |
| `createdAt` | timestamp | First discovered |
| `updatedAt` | timestamp | Last modified |

**Proposal entity** (pending changes awaiting review):

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Primary key |
| `projectId` | uuid/null | Null = new project proposal, set = update to existing |
| `sessionId` | string | Groups proposals from same discovery run |
| `field` | string | Which field is being proposed (e.g., `title`, `goals`, `status`) |
| `oldValue` | jsonb | Current value (null for new projects) |
| `newValue` | jsonb | Proposed value |
| `reason` | text | Agent's explanation for the change |
| `status` | enum | `pending`, `approved`, `rejected`, `edited` |
| `reviewedAt` | timestamp | When user acted on it |

### 3. Collector Backend — API Endpoints

**Projects CRUD:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/projects` | List all projects (filterable by `status`) |
| `GET` | `/api/v1/projects/:id` | Get single project with full details |
| `POST` | `/api/v1/projects` | Create project (used when proposals are approved) |
| `PUT` | `/api/v1/projects/:id` | Update project fields |
| `DELETE` | `/api/v1/projects/:id` | Archive/delete a project |

**Proposals:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/projects/proposals` | List pending proposals (filterable by `sessionId`, `status`) |
| `POST` | `/api/v1/projects/proposals` | Create proposal (called by MCP server) |
| `PUT` | `/api/v1/projects/proposals/:id/review` | Approve, reject, or edit a proposal. Body: `{ action, editedValue? }` |
| `POST` | `/api/v1/projects/proposals/batch-review` | Bulk approve/reject multiple proposals |

**Discovery session:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/projects/discover` | Launch discovery — creates temp workspace, writes MCP config, calls code-agent |
| `GET` | `/api/v1/projects/discover/:sessionId` | Get session status |
| `GET` | `/api/v1/projects/discover/:sessionId/events` | SSE stream — emits events as proposals arrive |

**Approval logic:** When a new project's proposals are approved, the backend creates the project from all approved field proposals in that group. When an update proposal is approved, the backend patches the specific field on the existing project.

### 4. Collector Frontend — Discovery & Review UI

A new page at `/projects` with two tabs:

**Tab 1: Projects Repository**
- Card grid/list of all discovered projects
- Each card: title, status badge, myRole badge, participant avatars, source icons, last updated
- Click to expand full project details (editable)
- Filter by status and role

**Tab 2: Discovery**
- "Run Discovery" button — launches a new session
- Live feed of proposals streaming in via SSE
- Proposals grouped by project (new vs updates)
- Diff-style display:
  - New project: all fields shown as green additions
  - Update: field name, old value (red), new value (green), agent's reason
- Per-field actions: Approve, Edit (inline), Reject
- Bulk actions: "Approve All" / "Reject All" per project group
- Session history — past discovery runs

### 5. Framework Plugin — Day Planner (`framework/plugins/day-planner/`)

**Slash command:** `/plan_day`

**Skills:**

| Skill | Purpose |
|-------|---------|
| `project_status` | For each active/informed project: fetch recent activity via collector search. Build status snapshot. |
| `daily_priorities` | Cross-project analysis: urgent items, blockers, today's meetings, approaching deadlines. Rank by importance. |

**Output:** Structured daily plan with:
- Per-project status (tailored by `myRole`):
  - `active`: detailed status, my tasks, blockers, next actions
  - `informed`: high-level summary, key changes
  - `muted`: skipped
- Today's priorities ranked
- Suggested actions
- Calendar context

**Data access:** Plugin uses curl templates against the collector REST API (projects endpoint + search). The MCP server is only used by the code-agent during discovery.

### 6. ChromaDB Cleanup

- Replace `code-agent/.docker/cursor/mcp.json` with empty `{"mcpServers": {}}`
- Remove chroma-related references from code-agent Dockerfile
- Scan and clean any remaining chroma mentions

## Architecture Diagram

```
                    Collector UI (React/MUI)
                         |
                    /projects page
                   /             \
         Projects Repo      Discovery Tab
              |                   |
              |            POST /discover
              |                   |
         GET /projects    Collector Backend
              |            |            |
              |      Create /tmp     SSE events
              |      workspace          |
              |         |          Proposals API
              |    .cursor/mcp.json     |
              |         |               |
              |    Code-Agent Service   |
              |         |               |
              |    Cursor Agent         |
              |         |               |
              |    Collector MCP Server |
              |    (stdio, bundled)     |
              |         |               |
              +--- Collector REST API --+
                         |
                   PostgreSQL / Redis
                   Elasticsearch

    Framework Plugin (/plan_day)
         |
    curl → Collector REST API
         |
    Projects + Search data
         |
    Synthesized daily plan
```

## Key Design Decisions

1. **MCP is repo-level** — written to the temp workspace, not global code-agent config
2. **Agent proposes via MCP write tools** — structured, validated data; not parsed from free-form output
3. **Field-level review** — git-diff style approve/edit/reject per field, not all-or-nothing
4. **Incremental enrichment** — discovery runs build on existing project data, never start from zero
5. **Role-based filtering** — `myRole` (active/informed/muted) controls what the day planner surfaces
6. **Markdown plugin** — framework plugin follows existing patterns (no code, curl templates)
7. **MCP server bundled with collector** — evolves with the API it wraps

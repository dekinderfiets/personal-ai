---
name: collector
description: Search, navigate, and manage the personal data collector service. Query indexed data from Gmail, Drive, Calendar, Slack, Jira, Confluence, and GitHub.
---

# Collector Tool

Interact with the personal data collector service via its REST API. The collector indexes data from multiple sources (Gmail, Drive, Calendar, Slack, Jira, Confluence, GitHub) and provides unified search and navigation.

## Prerequisites

### Environment Variables

| Variable | Description |
|----------|-------------|
| `COLLECTOR_API_URL` | Collector API base URL (default: `http://collector:8087/api/v1`, local dev: `http://localhost:8087/api/v1`) |
| `COLLECTOR_API_KEY` | API key for authentication |

### Authentication

All requests require the `x-api-key` header:

```bash
-H "x-api-key: ${COLLECTOR_API_KEY}"
```

---

## Available Sources

| Source | Document Types | Key Metadata |
|--------|---------------|--------------|
| `jira` | `issue`, `comment` | project, status, priority, assignee, labels, sprint |
| `slack` | `message`, `thread_reply` | channel, author, threadTs, mentionedUsers |
| `gmail` | `email` | subject, from, to, cc, labels, threadId |
| `drive` | `document`, `spreadsheet`, `presentation`, `pdf`, `other` | name, mimeType, path, owner |
| `confluence` | `page`, `blogpost`, `comment` | space, spaceName, author, labels |
| `calendar` | `event` | summary, start, end, attendees, organizer, location |
| `github` | `repository`, `issue`, `pull_request`, `pr_review`, `pr_comment` | repo, number, state, author, labels, assignees |

---

## API Reference

### Search

Perform semantic, keyword, or hybrid search across all indexed data.

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "search terms here",
    "sources": ["jira", "slack"],
    "searchType": "hybrid",
    "limit": 10,
    "startDate": "2026-01-01",
    "endDate": "2026-02-10"
  }'
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query text |
| `sources` | string[] | No | Filter by sources (default: all). Values: `jira`, `slack`, `gmail`, `drive`, `confluence`, `calendar`, `github` |
| `searchType` | string | No | `vector` (semantic), `keyword` (exact), or `hybrid` (both). Default: `hybrid` |
| `limit` | number | No | Max results to return (default: 10) |
| `offset` | number | No | Pagination offset |
| `where` | object | No | Metadata filters (source-specific) |
| `startDate` | string | No | Filter results after this date (ISO 8601) |
| `endDate` | string | No | Filter results before this date (ISO 8601) |

**Response:**

```json
[
  {
    "id": "doc-123",
    "source": "jira",
    "content": "Document content...",
    "metadata": {
      "title": "PROJ-42: Fix login bug",
      "status": "In Progress",
      "assignee": "user@example.com",
      "priority": "High",
      "url": "https://jira.example.com/browse/PROJ-42"
    },
    "score": 0.92
  }
]
```

### Navigate

Navigate context around a specific document (e.g., view thread replies, related issues, email chains).

```bash
curl -X GET "${COLLECTOR_API_URL}/navigate/${DOCUMENT_ID}?direction=children&scope=datapoint&limit=10" \
  -H "x-api-key: ${COLLECTOR_API_KEY}"
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `documentId` | string | Yes | ID of the document (path param) |
| `direction` | string | Yes | `prev`, `next`, `siblings`, `parent`, `children` |
| `scope` | string | Yes | `chunk` (within document), `datapoint` (related items), `context` (broader context) |
| `limit` | number | No | Max related results (default: 10) |

**Response:**

```json
{
  "current": {
    "id": "doc-123",
    "source": "slack",
    "content": "Original message...",
    "metadata": { ... },
    "score": 1.0
  },
  "related": [
    {
      "id": "doc-124",
      "source": "slack",
      "content": "Reply message...",
      "metadata": { ... },
      "score": 0.95
    }
  ],
  "navigation": {
    "hasPrev": false,
    "hasNext": true,
    "parentId": null,
    "contextType": "thread"
  }
}
```

### Index Status

Check the indexing status of all connectors.

```bash
curl -X GET "${COLLECTOR_API_URL}/index/status" \
  -H "x-api-key: ${COLLECTOR_API_KEY}"
```

**Response:**

```json
[
  {
    "source": "jira",
    "status": "completed",
    "lastSync": "2026-02-10T08:00:00Z",
    "documentsIndexed": 1523,
    "error": null
  }
]
```

### Trigger Indexing

Trigger re-indexing for a specific source or all sources.

```bash
# Single source
curl -X POST "${COLLECTOR_API_URL}/index/jira" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{ "fullReindex": false }'

# All sources
curl -X POST "${COLLECTOR_API_URL}/index/all" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## Common Query Templates

### Today's Calendar Events

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "meetings events today",
    "sources": ["calendar"],
    "searchType": "keyword",
    "startDate": "TODAY_START_ISO",
    "endDate": "TODAY_END_ISO",
    "limit": 50
  }'
```

### My Open Jira Issues

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "assigned open issues",
    "sources": ["jira"],
    "searchType": "hybrid",
    "where": { "status": "In Progress" },
    "limit": 20
  }'
```

### Recent Unread Emails

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "important emails",
    "sources": ["gmail"],
    "searchType": "hybrid",
    "startDate": "YESTERDAY_ISO",
    "limit": 20
  }'
```

### Recent Slack Messages Mentioning Me

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mentions direct messages",
    "sources": ["slack"],
    "searchType": "hybrid",
    "startDate": "YESTERDAY_ISO",
    "limit": 20
  }'
```

### Pending PR Reviews

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "pull request review requested open",
    "sources": ["github"],
    "searchType": "hybrid",
    "where": { "state": "open" },
    "limit": 20
  }'
```

### Search a Project/Topic Across All Sources

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "PROJECT_OR_TOPIC_NAME",
    "searchType": "hybrid",
    "limit": 30
  }'
```

### Activity in a Date Range

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "*",
    "searchType": "keyword",
    "startDate": "RANGE_START_ISO",
    "endDate": "RANGE_END_ISO",
    "limit": 50
  }'
```

---

## Tips for Plugin Authors

1. **Always use the `time` tool first** to get the current date/time before constructing date-based queries.
2. **Use `sources` filter** to narrow searches — querying all sources is expensive.
3. **Use `searchType: "hybrid"`** for most queries — it combines semantic understanding with keyword precision.
4. **Use `searchType: "keyword"`** when you need exact matches (e.g., issue keys like `PROJ-42`).
5. **Use `searchType: "vector"`** when the user's intent is fuzzy or conceptual (e.g., "things related to authentication").
6. **Paginate large results** using `limit` and `offset`.
7. **Use `startDate`/`endDate`** aggressively to scope queries to relevant time windows.
8. **Navigate for context** — after finding a document, use the navigate endpoint to get thread replies, related items, or parent documents.
9. **Check index status** if results seem stale — the source may not have been synced recently.
10. **Combine multiple targeted queries** rather than one broad query for better results.

---
name: nocodb
description: Interact with NocoDB databases via REST API. Perform CRUD operations on tables for storing and retrieving structured data.
---

# NocoDB Tool

Interact with NocoDB databases using the REST API v2.

## Prerequisites

### Environment Variables

Each plugin using NocoDB should define its own prefixed environment variables:

| Variable Pattern | Description |
|------------------|-------------|
| `{PREFIX}_NOCODB_HOST` | NocoDB instance URL (e.g., `https://nocodb.example.com`) |
| `{PREFIX}_NOCODB_API_TOKEN` | API token for authentication |
| `{PREFIX}_NOCODB_WORKSPACE` | Workspace identifier |
| `{PREFIX}_NOCODB_BASE_ID` | Base/project ID |
| `{PREFIX}_NOCODB_TABLE_ID` | Table ID to operate on |

---

## API Reference

All requests require the `xc-token` header for authentication.

### Create Record

```bash
curl -X POST "${NOCODB_HOST}/api/v2/tables/${NOCODB_TABLE_ID}/records" \
  -H "xc-token: ${NOCODB_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "field1": "value1",
    "field2": "value2"
  }'
```

### Read Records

**List all records:**
```bash
curl -X GET "${NOCODB_HOST}/api/v2/tables/${NOCODB_TABLE_ID}/records" \
  -H "xc-token: ${NOCODB_API_TOKEN}"
```

**With filtering:**
```bash
curl -X GET "${NOCODB_HOST}/api/v2/tables/${NOCODB_TABLE_ID}/records?where=(field,eq,value)" \
  -H "xc-token: ${NOCODB_API_TOKEN}"
```

**With sorting:**
```bash
curl -X GET "${NOCODB_HOST}/api/v2/tables/${NOCODB_TABLE_ID}/records?sort=fieldname" \
  -H "xc-token: ${NOCODB_API_TOKEN}"
```

**With pagination:**
```bash
curl -X GET "${NOCODB_HOST}/api/v2/tables/${NOCODB_TABLE_ID}/records?limit=25&offset=0" \
  -H "xc-token: ${NOCODB_API_TOKEN}"
```

### Update Record

```bash
curl -X PATCH "${NOCODB_HOST}/api/v2/tables/${NOCODB_TABLE_ID}/records" \
  -H "xc-token: ${NOCODB_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "Id": 123,
    "field1": "updated_value"
  }'
```

### Delete Record

```bash
curl -X DELETE "${NOCODB_HOST}/api/v2/tables/${NOCODB_TABLE_ID}/records" \
  -H "xc-token: ${NOCODB_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "Id": 123
  }'
```

---

## Filter Syntax

NocoDB uses a specific filter syntax in the `where` parameter:

| Operator | Meaning | Example |
|----------|---------|---------|
| `eq` | Equal | `(status,eq,active)` |
| `neq` | Not equal | `(type,neq,archived)` |
| `gt` | Greater than | `(date,gt,2026-02-01)` |
| `lt` | Less than | `(date,lt,2026-03-01)` |
| `like` | Contains | `(name,like,%search%)` |

**Combine filters with `~and` or `~or`:**
```
(status,eq,active)~and(type,eq,important)
```

---

## Response Format

**List response:**
```json
{
  "list": [
    {
      "Id": 1,
      "field1": "value1",
      "field2": "value2"
    }
  ],
  "pageInfo": {
    "totalRows": 42,
    "page": 1,
    "pageSize": 25,
    "isFirstPage": true,
    "isLastPage": false
  }
}
```

**Create/Update response:**
```json
{
  "Id": 1,
  "field1": "value1",
  ...
}
```

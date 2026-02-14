# Follow-Up Needed

Detect messages and emails that were sent but never received a response, and PR reviews that are still pending.

## Purpose

Tracks outbound communications and requests that haven't received responses. Identifies emails you sent with no reply and Slack messages that went unanswered.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `lookback_days` | No | How far back to search (default: 7) |
| `sources` | No | Limit to specific sources (default: all) |

## Outputs

- List of items awaiting response/follow-up, grouped by source

## Instructions

### Step 1: Get Current Time

Use the `time` tool. Calculate:
- `lookback_start`: Current date minus `lookback_days`

### Step 2: Find Emails Awaiting Response

Search for sent emails that may not have received replies.

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "sent follow up waiting response request",
    "sources": ["gmail"],
    "searchType": "hybrid",
    "startDate": "<lookback_start>",
    "limit": 20
  }'
```

**Processing:**
- Look for emails where user is the sender (user's email in `metadata.from`)
- Check `metadata.thread_depth` — a depth of 1 with user as sender suggests no reply received
- Check for emails with "?" in the subject/content (questions expecting answers)
- Filter out automated emails, newsletters, notifications
- For each: extract recipient, subject, date sent, url

### Step 3: Find Slack Messages Awaiting Response

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "question request help review thoughts",
    "sources": ["slack"],
    "searchType": "hybrid",
    "startDate": "<lookback_start>",
    "limit": 20
  }'
```

**Processing:**
- Look for messages authored by the user (check `metadata.author`)
- Identify messages that are questions or requests (contain "?", "can you", "please", "thoughts on")
- Use the navigate endpoint to check if there are replies to the thread:
  ```bash
  curl -X GET "${COLLECTOR_API_URL}/navigate/<message_id>?direction=children&scope=datapoint&limit=5" \
    -H "x-api-key: ${COLLECTOR_API_KEY}"
  ```
- If no replies or only user's own replies, flag as needing follow-up
- For each: extract channel, message snippet, date, url

### Step 4: Find Unanswered Confluence Comments

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "comment question feedback",
    "sources": ["confluence"],
    "searchType": "hybrid",
    "where": { "type": "comment" },
    "startDate": "<lookback_start>",
    "limit": 10
  }'
```

**Processing:**
- Look for comments by the user with questions that haven't been addressed
- Check for comments on the user's pages that may need responses

### Step 5: Format Output

```markdown
## 📬 Follow-Ups Needed (X total)

### Emails Awaiting Reply (X)
| Sent To | Subject | Sent | Days Waiting |
|---------|---------|------|-------------|
| alice@co.com | API contract proposal | Feb 5 | 5d |
| bob@co.com | Budget approval needed | Feb 7 | 3d |

### Slack Messages Unanswered (X)
| Channel | Message | Sent | Days Waiting |
|---------|---------|------|-------------|
| #backend | "Can someone review the migration plan?" | Feb 6 | 4d |
| DM @carol | "Did you get the design specs?" | Feb 8 | 2d |

### Other Follow-Ups (X)
[Confluence comments, etc.]
```

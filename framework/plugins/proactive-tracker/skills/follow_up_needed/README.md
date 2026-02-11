# Follow-Up Needed

Detect messages and emails that were sent but never received a response, and PR reviews that are still pending.

## Purpose

Tracks outbound communications and requests that haven't received responses. Identifies emails you sent with no reply, Slack messages that went unanswered, and PR reviews you requested that are still pending.

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

### Step 4: Find Pending PR Reviews

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "pull request review open requested",
    "sources": ["github"],
    "searchType": "hybrid",
    "where": { "state": "open" },
    "startDate": "<lookback_start>",
    "limit": 15
  }'
```

**Processing:**
- Find PRs authored by the user (`metadata.is_author` = true) that are still open and awaiting review
- Find PRs where the user is a requested reviewer (`metadata.is_assigned_to_me` = true)
- Calculate how long each review has been pending
- For each: extract PR title, repo, requested reviewers, age, url

### Step 5: Find Unanswered Confluence Comments

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

### Step 6: Format Output

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

### PR Reviews Pending (X)
| PR | Repo | Waiting For | Age |
|----|------|-------------|-----|
| #234 Add auth | myapp | @alice, @bob | 3d |
| #256 Fix tests | mylib | @carol | 1d |

### Other Follow-Ups (X)
[Confluence comments, etc.]
```

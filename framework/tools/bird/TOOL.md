---
name: bird
description: Read X/Twitter data using the bird CLI (@steipete/bird). Fetch tweets, threads, user timelines, search results, bookmarks, and mentions. Use when the user asks to read tweets, check Twitter/X content, fetch someone's timeline, or gather social media data.
---

# Bird Skill

Read X/Twitter data via the `@steipete/bird` CLI.

## Prerequisites

Run with npx (no installation required):
```bash
npx @steipete/bird <command>
```

## Quick Reference

| Task | Command |
|------|---------|
| Read tweet | `npx @steipete/bird read <url\|id> --json` |
| Full thread | `npx @steipete/bird thread <url\|id> --json` |
| User timeline | `npx @steipete/bird user-tweets @handle -n 20 --json` |
| Search | `npx @steipete/bird search "query" -n 10 --json` |
| Mentions | `npx @steipete/bird mentions -n 10 --json` |
| Bookmarks | `npx @steipete/bird bookmarks -n 10 --json` |
| Likes | `npx @steipete/bird likes -n 10 --json` |
| News/Trending | `npx @steipete/bird news -n 10 --json` |

## Output

Tweet objects include:
- `id`, `text`, `author` ({username, name})
- `createdAt`, `replyCount`, `retweetCount`, `likeCount`
- `conversationId`, `inReplyToStatusId`, `quotedTweet`

## Usage

1. Identify what data you need (timeline, specific tweet, search, etc.)
2. Use the appropriate command from the quick reference above
3. Parse the JSON response to extract relevant fields

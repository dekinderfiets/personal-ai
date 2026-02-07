# Fetch Content

Gather content from X/Twitter.

## Purpose

Uses the `bird` tool to fetch tweets based on source type (news, feed, bookmarks, etc.).

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `source` | Yes | `news`, `feed`, `bookmarks`, `mentions`, `likes`, `search` |
| `count` | No | Number of items (default: 50) |

## Instructions

### Step 1: Execute Bird Command

Use `tools/bird` based on source:

| Source | Command |
|--------|---------|
| `news` | `npx @steipete/bird news --news-only --ai-only -n {count} --json` |
| `feed` | `npx @steipete/bird user-tweets @me -n {count} --json` |
| `bookmarks` | `npx @steipete/bird bookmarks -n {count} --json` |
| `mentions` | `npx @steipete/bird mentions -n {count} --json` |
| `likes` | `npx @steipete/bird likes -n {count} --json` |
| `search:<query>` | `npx @steipete/bird search "{query}" -n {count} --json` |

### Step 2: Extract Fields

For each tweet, extract: ID, text, author, timestamp, metrics, media.

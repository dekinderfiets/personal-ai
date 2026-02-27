# Rail Timings Plugin

Get train schedules and timings from Israel Railways (`rail.co.il`).

## Capabilities

- Get train times from station A to station B.
- Support for specific dates and times.
- Handles the SPA nature of the site and bypasses Cloudflare using the `web-browser` tool with **stealth mode** (enabled by default).

## Usage

### Get Next Trains
Search for trains from Tel Aviv Savidor Merkaz to Haifa Merkaz HaShmona for today.

#### Step 1: Discover station IDs (if needed)
The plugin uses station names. The `web-browser` tool will handle the lookup on the site.

#### Step 2: Execute Search
Use the `web-browser` tool to perform the search.

```bash
python3 framework/tools/web-browser/scripts/browser.py run-actions '{
  "url": "https://www.rail.co.il/en",
  "actions": [
    {"type": "type", "selector": "input[placeholder=\"From\"]", "text": "Tel Aviv - Savidor Merkaz"},
    {"type": "wait", "ms": 1000},
    {"type": "press", "key": "Enter"},
    {"type": "type", "selector": "input[placeholder=\"To\"]", "text": "Haifa - Merkaz HaShmona"},
    {"type": "wait", "ms": 1000},
    {"type": "press", "key": "Enter"},
    {"type": "click", "selector": ".search-btn"},
    {"type": "wait", "ms": 5000}
  ]
}'
```

## Internal Skills

### `railway`
Contains CSS selectors and specific logic for parsing the Israel Railways website.
See [skills/railway/README.md](skills/railway/README.md).

---
name: web-browser
description: Interact with the web using Browserless. Support for navigation, clicking, typing, and scraping content from SPAs.
---

# Web Browser Tool

A high-level tool for interacting with websites using a headless browser (Browserless).

## Usage

The tool is implemented as a Python script that communicates with the Browserless API.

### Actions

#### 1. Navigate and Get Content
Get the full rendered HTML of a page after a specified wait time.

```bash
python3 framework/tools/web-browser/scripts/browser.py scrape "https://www.rail.co.il/en" --wait 5000
```

#### 2. Screenshot
Capture a screenshot of a page.

```bash
python3 framework/tools/web-browser/scripts/browser.py screenshot "https://www.rail.co.il/en" --output "rail_home.png"
```

#### 3. Custom Actions (JSON)
Perform a sequence of actions like clicking, typing, etc.

```bash
python3 framework/tools/web-browser/scripts/browser.py run-actions '{
  "url": "https://www.rail.co.il/en",
  "actions": [
    {"type": "click", "selector": "#fromStation"},
    {"type": "type", "selector": "#fromStation", "text": "Tel Aviv"},
    {"type": "wait", "ms": 2000}
  ]
}'
```

## Browserless Info
- **Internal URL**: `http://browserless:3000` (Preferred inside Docker)
- **External URL**: `http://localhost:3000` (Fallback for local scripts)
- **Stealth Mode**: Enabled by default to bypass Cloudflare/bot detection.

### Stealth Mode Usage

The tool automatically applies stealth configurations to requests. To disable (if needed):

```bash
python3 framework/tools/web-browser/scripts/browser.py scrape "https://example.com" --no-stealth
```

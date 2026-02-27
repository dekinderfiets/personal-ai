import argparse
import json
import requests
import sys
import os

# Prefer internal Docker DNS name if available, fallback to localhost
BROWSERLESS_URL = os.environ.get("BROWSERLESS_URL", "http://browserless:3000")
if not os.environ.get("BROWSERLESS_URL") and os.system("ping -c 1 browserless > /dev/null 2>&1") != 0:
    BROWSERLESS_URL = "http://localhost:3000"

def scrape_url(url, wait_ms=None, stealth=True):
    params = {
        "url": url,
        "elements": [{"selector": "body"}],
        "stealth": stealth
    }
    if wait_ms:
        params["waitFor"] = wait_ms

    try:
        response = requests.post(f"{BROWSERLESS_URL}/content", json=params, timeout=30)
        response.raise_for_status()
        print(response.text)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

def take_screenshot(url, output_path, stealth=True):
    params = {
        "url": url,
        "stealth": stealth,
        "options": {
            "fullPage": True,
            "type": "png"
        }
    }
    try:
        response = requests.post(f"{BROWSERLESS_URL}/screenshot", json=params, timeout=30)
        response.raise_for_status()
        with open(output_path, "wb") as f:
            f.write(response.content)
        print(f"Screenshot saved to {output_path}")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

def run_actions(actions_json):
    # For more complex actions, we use the /playwright/execute endpoint
    # This expects a JavaScript snippet. We'll wrap the JSON actions into a JS script.
    
    script = f"""
    const {{ chromium }} = require('playwright');
    (async () => {{
      const browser = await chromium.launch();
      const page = await browser.newPage();
      const data = {actions_json};
      
      await page.goto(data.url);
      
      for (const action of data.actions) {{
        if (action.type === 'click') {{
          await page.click(action.selector);
        }} else if (action.type === 'type') {{
          await page.fill(action.selector, action.text);
        }} else if (action.type === 'wait') {{
          await page.waitForTimeout(action.ms);
        }} else if (action.type === 'press') {{
          await page.keyboard.press(action.key);
        }}
      }}
      
      const content = await page.content();
      console.log(content);
      
      await browser.close();
    }})();
    """
    
    try:
        response = requests.post(
            f"{BROWSERLESS_URL}/playwright/execute",
            data=script,
            headers={"Content-Type": "application/javascript"},
            timeout=60
        )
        response.raise_for_status()
        print(response.text)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Web Browser Tool Script")
    subparsers = parser.add_subparsers(dest="command")

    # Scrape command
    scrape_parser = subparsers.add_parser("scrape")
    scrape_parser.add_argument("url", help="URL to scrape")
    scrape_parser.add_argument("--wait", type=int, help="Wait time in ms")

    # Screenshot command
    screenshot_parser = subparsers.add_parser("screenshot")
    screenshot_parser.add_argument("url", help="URL to capture")
    screenshot_parser.add_argument("--output", default="screenshot.png", help="Output file path")

    # Run-actions command
    actions_parser = subparsers.add_parser("run-actions")
    actions_parser.add_argument("json", help="JSON string with actions")
    actions_parser.add_argument("--no-stealth", action="store_false", dest="stealth", default=True, help="Disable stealth mode")

    args = parser.parse_args()

    if args.command == "scrape":
        scrape_url(args.url, args.wait, getattr(args, 'stealth', True))
    elif args.command == "screenshot":
        take_screenshot(args.url, args.output, getattr(args, 'stealth', True))
    elif args.command == "run-actions":
        run_actions(args.json)
    else:
        parser.print_help()

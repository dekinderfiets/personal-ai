# Railway Skill

Specific logic for interacting with the Israel Railways website (`rail.co.il`).

## Selectors (English Site)

| Element | Selector |
|---------|----------|
| From Station Input | `input[placeholder="From"]` |
| To Station Input | `input[placeholder="To"]` |
| Search Button | `.search-btn` |
| Train Rows | `.train-row` |
| Departure Time | `.departure-time` |
| Arrival Time | `.arrival-time` |
| Platform | `.platform` |

## Complex Navigation Logic

To handle the SPA nature and Cloudflare:
1.  **Wait for hydration**: The site takes a few seconds to load the station list in the background.
2.  **Explicit Waits**: Use `waitForTimeout` after typing station names to allow the autocomplete to appear and be selectable.
3.  **Keyboard Navigation**: Sometimes it's safer to type the name and press `Enter` than to try and click a specific autocomplete item.

## Example Parsing Script (Node.js/Playwright)

If using a custom script via the `web-browser` tool's `run-actions`:

```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://www.rail.co.il/en');
  
  // Fill search
  await page.fill('input[placeholder="From"]', 'Tel Aviv - Savidor Merkaz');
  await page.keyboard.press('Enter');
  await page.fill('input[placeholder="To"]', 'Haifa - Merkaz HaShmona');
  await page.keyboard.press('Enter');
  
  // Search
  await page.click('.search-btn');
  await page.waitForSelector('.train-row', { timeout: 10000 });
  
  // Extract
  const trains = await page.$$eval('.train-row', rows => 
    rows.map(row => ({
      departure: row.querySelector('.departure-time')?.innerText,
      arrival: row.querySelector('.arrival-time')?.innerText,
      platform: row.querySelector('.platform')?.innerText
    }))
  );
  
  console.log(JSON.stringify(trains, null, 2));
  await browser.close();
})();
```

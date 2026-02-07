# Finance Advisor

Your personal AI accountant and financial strategist.

## Purpose

Acts as a dedicated accountant to track spending, audit expenses for anomalies, and provide strategic financial advice. Unlike simple trackers, the Finance Advisor looks for patterns, potential errors, and optimization opportunities.

## Capabilities

- **Transaction Auditing**: Detects duplicates, subscription creeps, and suspicious outliers.
- **Financial Statements**: Generates professional P&L-style statements for personal finance.
- **Strategic Forecasting**: analyzes burn rate with context.
- **Spending Analysis**: Deep dives into categories and merchants.

## Commands

| Command | Description |
|---------|-------------|
| `/daily_financial_brief` | Provides a quick summary of today's spending and the current month's status. Invokes `skills/audit_expenses`, `skills/analyze_subscriptions`, and `skills/generate_financial_statement`. |

## When to Use

Use this plugin when:
- User asks for a financial status update.
- User wants to know "Can I afford X?".
- User suspects double billing or wants to check for forgotten subscriptions.
- User wants a monthly financial review.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `budget` | No | Monthly budget limit (default: 20,000 NIS) |
| `cycle_day` | No | Day of month when cycle starts (default: 15) |

## Outputs

- Professional financial statements (Markdown)
- Audit alerts and findings
- Strategic recommendations

## Dependencies

- **Tools**: `time`
- **Other Plugins**: None

## Data Sources

> [!IMPORTANT]
> **Source of Truth**: All transaction data resides in local JSON files in `context/datasets/financial`.
> - **Do NOT** assume data exists in `context/datasets` for transaction files. Always check the plugin's README to confirm the authoritative data source.
> - **Do NOT** simulate data unless the user explicitly requests a simulation.
> - Use standard file tools to read data from the local files.

---

## Instructions

### Pre-Execution

1. Read `brain/guidelines.md` for output standards
2. Read `tools/time/TOOL.md` for getting current time
3. Verify access to `context/datasets/financial` directory.

### Table Schema

The local JSON files contain a `transactions` array where each item has a `json` object with the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `merchantName` | string | Name of merchant |
| `actualPaymentAmount` | number | Final payment in NIS (may be null if pending) |
| `originalAmount` | number | Original transaction amount (fallback) |
| `purchaseDate` | datetime | Transaction timestamp (ISO 8601) |
| `originalCurrency` | string | ILS, USD, EUR, etc. |
| `categoryId` | number | Category enum from credit card provider |

---

### Step 1: Fetch Transactions

Calculate the billing date range (15th to 15th) based on the current date, then locate and read the relevant JSON file(s) from `context/datasets/financial`.

**Date Logic:**
- If `today.day >= 15`: Start=`ThisMonth-15`, End=`NextMonth-15`
- Else: Start=`LastMonth-15`, End=`ThisMonth-15`

**Command:**
Use your standard file tools (`list_dir`, `view_file`, `grep`, etc.) to:
1. List files in `context/datasets/financial`.
2. frequent the file(s) corresponding to the months in your calculated date range (e.g., `2026-02.json`).
3. Parse the JSON content to extract the transaction list.

### Step 2: Audit Expenses & Subscriptions
Use `skills/audit_expenses` to scan for anomalies.
Use `skills/analyze_subscriptions` to detail recurring costs.

### Step 3: Forecast
Use `skills/forecast_cashflow` to project end-of-month scenarios.

### Step 4: Generate Financial Statement
Use `skills/generate_financial_statement` to produce the executive summary and detailed report (incorporating audit and forecast findings).

---

### Post-Execution

1. Return the generated report to the user
2. Summarize key findings (status, forecast, top categories)

### Error Handling

- **No transactions found**: Report zero spending for the cycle
- **Missing actualPaymentAmount**: Fall back to originalAmount
- **All null amounts**: Skip transaction in calculations

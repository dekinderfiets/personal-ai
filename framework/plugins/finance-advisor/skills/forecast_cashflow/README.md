# Forecast Cashflow

Project future financial state using detailed analysis.

## Purpose

Predicts end-of-month balance by distinguishing between fixed recurring costs (subscriptions, rent) and variable daily spending patterns.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `transactions` | Yes | Current cycle transactions |
| `budget` | No | Total budget |
| `cycle_end_date` | Yes | Date cycle ends |

## Prerequisites

> [!CRITICAL]
> **Strict Data Requirement**: usage of this skill requires REAL transaction data from NocoDB.
> **DO NOT generate sample data.**
> **DO NOT hallucinate transactions.**

### Data Fetching Protocol

1. **Attempt to run the curl command below.**
   - If you have access to a shell/terminal tool, execute it.
   - If successful, use the JSON output as your `transactions` input.

2. **FAILURE MODE: If you act as a chatbot (e.g., Telegram) and cannot run shell commands:**
   - **STOP IMMEDIATELY.**
   - **DO NOT** produce a forecast with fake numbers.
   - Output the command below in a code block and ask the user to run it and paste the result.

**Fetch Command:**
```bash
# 1. Calculate dates:
# If today >= 15th: Start=ThisMonth-15, End=NextMonth-15
# Else:             Start=LastMonth-15, End=ThisMonth-15

# 2. Run curl (replace dates YYYY-MM-DD):
curl -X GET "${CREDIT_CARD_TRANSACTIONS_NOCODB_HOST}/api/v2/tables/${CREDIT_CARD_TRANSACTIONS_NOCODB_TABLE_ID}/records?where=(purchaseDate,ge,${START_DATE})~and(purchaseDate,lt,${END_DATE})&limit=500" \
  -H "xc-token: ${CREDIT_CARD_TRANSACTIONS_NOCODB_API_TOKEN}"
```

## Instructions

### Step 1: Identify Fixed Costs

Scan transactions for known recurring merchants (Netflix, Rent, Internet).
- Sum their total.
- Check which have *already* been paid this cycle.
- Calculate `remaining_fixed_obligations`.

### Step 2: Analyze Variable Spending

Filter out fixed cost transactions.
- Calculate `variable_burn_rate` (Daily average of food, fun, transport).

### Step 3: Project Future

1. `projected_fixed = remaining_fixed_obligations`
2. `projected_variable = variable_burn_rate * days_remaining`
3. `forecast_total = current_spent + projected_fixed + projected_variable`

### Step 4: Scenario Analysis

Provide 3 scenarios:
- **Conservative**: Current burn rate continues.
- **Optimistic**: Burn rate drops by 20%.
- **Pessimistic**: Burn rate increases by 20% (unforeseen expenses).

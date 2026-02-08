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

## Data Access

> [!IMPORTANT]
> **Source of Truth**: All transaction data resides in local JSON files in `context/datasets/financial`.
> **DO NOT** assume data exists in `context/datasets` for transaction files.
> **DO NOT** simulate data unless explicitly requested.

### Data Fetching Protocol

1. **Check Date**: Always use the `time` tool to get the current date first. This ensures you know where you are in the cycle.
2. **Locate Files**: List files in `context/datasets/financial`.
3. **Access Data**: Read the JSON files corresponding to the current cycle's months.
4. **Filter Logic**:
   - A transaction belongs to the current cycle if:
     - `paymentDate` is **null** (pending).
     - **OR** `paymentDate` is **after** the 15th of the previous month (not including the 15th).

**Example Start Date calculation:**
If today is **Feb 7, 2026**:
- Start Date = **Jan 15, 2026** (exclusive).
- Query = `paymentDate == null || paymentDate > "2026-01-15"`.

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

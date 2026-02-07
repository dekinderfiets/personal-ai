# Audit Expenses

Review transactions for anomalies, potential errors, and insights.

## Purpose

Acts as a vigilant accountant by scanning the ledger for duplicate charges, subscription creep, and unusual spending patterns.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `transactions` | Yes | List of transaction records |

## Outputs

- List of "Audit Findings" (warnings, alerts, insights).

## Instructions

### Step 1: Duplicate Detection

Identify transactions with identical:
- Amount AND Merchant AND Date (within 24h)
- Flag as "Potential Duplicate".

### Step 2: Subscription Check

Identify recurring merchants from previous months (if history available) or known subscription services (Netflix, Spotify, etc.).
- Flag "New Subscription" if not seen before.
- Flag "Price Increase" if amount > previous.

### Step 3: High Value Monitor

Flag meaningful outliers:
- Single transaction > 1000 NIS (configurable).
- "Unusual Merchant" (if possible).

### Step 4: Report Findings

Compile a list of findings to be included in the financial statement explicitly.

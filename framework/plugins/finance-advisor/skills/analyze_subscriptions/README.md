# Analyze Subscriptions

Audit and list recurring expenses.

## Purpose

Identifies active subscriptions, calculates total monthly recurring revenue (MRR) outflow, and flags price increases.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `transactions` | Yes | List of transactions (ideally from multiple months for better accuracy, but works with one) |

## Instructions

### Step 1: Detect Subscriptions

Identify transactions that match subscription patterns:
- Known merchants (Netflix, Spotify, Apple, Google, Adobe).
- Regular amounts (e.g. 29.90 occurring same day).

**Determine Status**:
- **Active**: Payment detected in the most recent billing cycle (last 30-31 days).
- **Stopped**: No payment detected in the last cycle (e.g., service stopped 2 months ago are no longer subscriptions).

### Step 2: Calculate Metrics

- **Total Monthly Cost**: Sum of all **Active** subscriptions only.
- **Yearly Run Rate**: Monthly * 12.

### Step 3: Audit Changes

If historical data is available (or user provides context):
- Flag **Price Hikes**: Service cost > previous month.
- Flag **Zombie Subs**: Services not used (requires usage data, or just ask user to verify).

### Step 4: Report

Generate a "Subscription Audit" table:
| Service | Cost | Status | Last Payment |
|---------|------|--------|--------------|
| Netflix | ₪49 | Active | 3 days ago |
| Disney+ | ₪39 | Stopped| 2 months ago |

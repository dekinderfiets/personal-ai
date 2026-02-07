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

### Step 2: Calculate Metrics

- **Total Monthly Cost**: Sum of all active subscriptions.
- **Yearly Run Rate**: Monthly * 12.

### Step 3: Audit Changes

If historical data is available (or user provides context):
- Flag **Price Hikes**: Service cost > previous month.
- Flag **Zombie Subs**: Services not used (requires usage data, or just ask user to verify).

### Step 4: Report

Generate a "Subscription Audit" table:
| Service | Cost | Status |
|---------|------|--------|
| Netflix | ₪49 | Active |

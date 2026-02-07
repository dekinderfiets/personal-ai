# Generate Financial Statement

Process transaction data into a professional financial report.

## Purpose

Generates a generic "Personal P&L" statement, executive summary, and strategic recommendations based on audit findings.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `transactions` | Yes | List of transaction records |
| `audit_findings` | No | List of alerts from Audit skill |
| `budget` | No | Monthly limit (default: 20000) |
| `billing_dates` | Yes | Start and end dates of the cycle |

## Outputs

- Markdown formatted Financial Statement.

## Instructions

### Step 1: Executive Summary

Calculate high-level metrics:
- **Net Position**: Budget vs Actual.
- **Runway/Burn**: Daily stats.
- **Audit Status**: "Clean" or "Issues Found".

### Step 2: Statement of Activity (P&L)

Group expenses by category and sort descending.
- Column 1: Category
- Column 2: Actual
- Column 3: % of Total

### Step 3: Audit Report

Include a dedicated section for any findings from the `audit_expenses` skill.
- 🔴 Critical: Duplicates
- 🟡 Warning: New subscriptions / High value

### Step 4: Strategic Commentary

Generate LLM-based advice focusing on:
- optimizing top spend categories.
- addressing audit findings.

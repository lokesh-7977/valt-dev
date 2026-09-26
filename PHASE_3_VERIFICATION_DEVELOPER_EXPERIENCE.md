# GhostCrew — Phase 3: Verification & Developer Experience

## Phase Objective

Turn GhostCrew's autonomous test results and intelligence findings into a trustworthy, actionable developer experience.

> **GhostCrew verifies suspicious behavior before reporting it, then surfaces confirmed bugs directly inside the developer's browser with clear evidence and actionable reporting.**

Phase 3 is owned by **Developer 3**.

---

# 1. Product Scope

Phase 3 owns:

1. Autonomous bug verification
2. False-positive reduction
3. Bug classification
4. In-page bug popups
5. Chrome side panel
6. Live activity feed
7. Open-bug management
8. Contract visualization
9. Developer controls
10. Evidence presentation
11. Linear ticket creation
12. Bug deduplication
13. Auto-close for fixed bugs
14. End-to-end flow presentation/results

---

# 2. Bug Verification

A potential finding from Phase 2 is not automatically treated as a confirmed bug.

GhostCrew should verify it.

### Verification flow

```text
Potential issue
      ↓
Rerun exact reproduction
      ↓
Does it reproduce?
      ↓
Gemini evaluates evidence
      ↓
Bug / Expected / Flaky
      ↓
Confirmed bug
```

GhostCrew should only surface the issue as a confirmed bug when:

- The behavior reproduces
- The evidence supports the finding
- The final judgment identifies it as a bug with sufficient confidence

---

# 3. False-Positive Handling

GhostCrew should distinguish:

```text
BUG
EXPECTED
FLAKY
```

Expected behavior should not repeatedly appear as a new issue.

The developer should be able to mark a finding as expected.

That decision should be remembered so the same known behavior is not repeatedly reported.

---

# 4. Bug Classification

Every confirmed issue should contain:

### Title

Example:

```text
Quantity accepts negative values
```

### Severity

- Critical
- High
- Medium
- Low

### Layer

- UI
- API
- UI ↔ API
- Business Rule

### Page

Example:

```text
/invoices/new
```

### Field/action

Example:

```text
Quantity
```

### Expected behavior

What should have happened.

### Actual behavior

What actually happened.

### Reproduction steps

The exact sequence GhostCrew used.

---

# 5. In-Page Bug Popup

The primary developer experience is an in-page GhostCrew popup.

The popup should appear beside the problematic element.

Example:

```text
                  ┌────────────────────────────┐
                  │ 🔴 GhostCrew Bug           │
                  │                            │
                  │ Quantity accepts -5        │
                  │                            │
                  │ Severity: High             │
                  │ Layer: UI ↔ API            │
                  │                            │
                  │ Expected: >= 0             │
                  │ Actual: -5 accepted        │
                  │                            │
                  │ [View Evidence]            │
                  │ [Ignore] [Expected]        │
                  │ [File Ticket]              │
                  └────────────────────────────┘
```

The popup should remain visually associated with the affected element.

---

# 6. Popup Information

The bug popup should show:

- Bug title
- Severity
- Layer
- Page
- What GhostCrew did
- Reproduction steps
- Expected behavior
- Actual behavior
- Evidence
- Screenshot
- Request/response details
- Likely cause
- Reproduction status

---

# 7. Bug Actions

The developer should be able to:

### Ignore

Suppress the issue.

### Mark as Expected

Tell GhostCrew that the behavior is intentional.

### View Evidence

Open detailed evidence.

### File Ticket

Create a Linear issue.

The developer should not need to manually reconstruct the bug report.

---

# 8. Evidence Viewer

For every confirmed bug, show the evidence GhostCrew used.

Example:

```text
WHAT GHOSTCREW DID

1. Opened Invoice form
2. Entered customer = Acme
3. Entered quantity = -5
4. Clicked Save

EXPECTED

Quantity should be rejected.

ACTUAL

Invoice was accepted.

REQUEST

POST /api/invoices

{
  "quantity": -5
}

RESPONSE

200 OK

{
  "success": true
}
```

Where appropriate, also show:

- Screenshot
- Console information
- Business-rule evidence
- UI state

---

# 9. Chrome Side Panel

The side panel is the main GhostCrew control center.

---

## Live Activity

Show what GhostCrew is doing now.

Example:

```text
GhostCrew is working...

✓ Discovered Customers
✓ Tested Customer form
✓ Completed 18 cases

⚡ Testing Invoice form
   Case 14/32

🔴 2 confirmed issues
```

---

# 10. Open Bugs

The side panel should show all currently known issues.

Allow filtering by:

- Severity
- Layer
- Page

Example:

```text
Open Bugs

🔴 Critical     1
🟠 High         3
🟡 Medium       5
🔵 Low          2
```

---

# 11. Contract View

The developer should be able to select a form and see the UI ↔ API relationship.

Example:

| UI Value | Request Value | Response Value |
|---|---|---|
| Quantity: 5 | quantity: 5 | quantity: 5 |
| Discount: 10% | — | — |
| Total: ₹5,900 | total: ₹5,000 | total: ₹5,000 |

Use clear success/failure indicators.

This should make contract problems understandable without requiring the developer to inspect network logs manually.

---

# 12. Developer Controls

The side panel should provide:

### Live / Paused

Allow the developer to temporarily pause autonomous activity.

### Full Sweep

Start a complete application sweep.

### Role Selector

Allow the developer to select the role under which GhostCrew should test.

Example:

```text
Role:
Admin ▼
```

### Destructive Actions

Provide an explicit control for whether destructive actions are allowed.

Default:

```text
Allow destructive actions: OFF
```

---

# 13. Autonomous End-to-End Flows

Phase 3 should present and manage higher-level application flows.

Example ERP flow:

```text
Create Product
      ↓
Create Purchase Order
      ↓
Approve PO
      ↓
Receive Goods
      ↓
Stock increases
      ↓
Create Invoice
      ↓
Stock decreases
      ↓
Record Payment
      ↓
Invoice becomes Paid
```

Each step should be checked against:

- UI state
- API response
- Business rules

---

# 14. Flow Results

When a flow completes, GhostCrew should show:

```text
Invoice → Payment Flow

✓ Product created
✓ Purchase order created
✓ PO approved
✓ Goods received
✓ Stock increased
✓ Invoice created
❌ Stock did not decrease
✓ Payment recorded

1 business-rule issue found
```

The user should be able to open the failing step and inspect its evidence.

---

# 15. Linear Ticketing

For confirmed bugs, GhostCrew should provide a direct ticketing action.

Example title:

```text
[GhostCrew][High][UI↔API]
Invoice form sends quantity as string
```

The ticket should contain:

- Title
- Severity
- Layer
- Reproduction steps
- Expected behavior
- Actual behavior
- Request/response evidence
- Page URL
- Environment
- Relevant business rule
- Screenshot
- Relevant reproduction evidence

---

# 16. Ticket Deduplication

GhostCrew should avoid creating duplicate tickets for the same issue.

A bug identity can be based on:

```text
Page
+
Form
+
Field
+
Check type
```

If the same issue is found again:

```text
Existing ticket

        ↓

Add update/comment

"Still reproducing"
```

rather than creating another issue.

---

# 17. Auto-Close Fixed Bugs

When a later GhostCrew run no longer reproduces an existing bug:

```text
Previous run:
❌ Bug

New run:
✓ Passing

        ↓

GhostCrew verifies

        ↓

Bug fixed
```

The corresponding ticket can be updated as verified fixed and moved to Done.

---

# 18. Developer Experience Principle

The developer should not have to:

- Open browser DevTools
- Manually reproduce the issue
- Copy request payloads
- Compare responses
- Write reproduction steps
- Explain expected vs actual
- Manually create every ticket

GhostCrew should perform this work automatically.

---

# 19. Hackathon-Focused Live Experience

The side panel should make GhostCrew's autonomous speed visible.

Example:

```text
GhostCrew

FULL SWEEP COMPLETE

38 checks
6 agents
7.2 seconds

Pages tested: 12
Forms tested: 8
API interactions: 24

Issues found:
2 Critical
3 High
```

The user should immediately understand that GhostCrew is continuously working rather than waiting for a "Run Tests" button.

---

# 20. Phase 3 Completion Criteria

Phase 3 is complete when GhostCrew can:

- Receive potential findings
- Reproduce suspicious behavior
- Verify bugs
- Reduce false positives
- Classify confirmed bugs
- Display bugs directly on the affected page
- Provide detailed evidence
- Show live activity
- Show open bugs
- Provide UI ↔ API contract visualization
- Provide developer controls
- Run/present end-to-end flow results
- Create Linear tickets
- Deduplicate repeated issues
- Auto-close verified fixes

### Phase 3 statement

> **GhostCrew verifies real failures and turns them into clear, evidence-backed, actionable feedback directly inside the developer's browser.**

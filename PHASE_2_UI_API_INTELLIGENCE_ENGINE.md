# GhostCrew — Phase 2: UI ↔ API Intelligence Engine

## Phase Objective

Build the intelligence layer that determines whether the application actually behaved correctly.

> **GhostCrew compares what it entered and observed in the UI with what the application sent, what the API returned, and what the application ultimately displayed.**

Phase 2 is owned by **Developer 2**.

Phase 2 consumes test actions and evidence produced by Phase 1 and turns them into meaningful QA findings.

---

# 1. Product Scope

Phase 2 owns:

1. UI observation
2. Network/API observation
3. Request/response evidence
4. UI ↔ API comparison
5. Contract checking
6. API replay for relevant validation/security gaps
7. Business-rule checking
8. Data-integrity checking
9. Gemini reasoning
10. Potential-bug generation
11. Structured findings for Phase 3

---

# 2. UI Evidence

For every autonomous test, GhostCrew should record what happened in the UI.

Capture relevant information such as:

- Values entered
- Visible validation messages
- Success messages
- Error messages
- Loading state
- Resulting page state
- Updated values
- Whether a new record appeared
- Screenshots where useful

Example:

```text
GhostCrew entered:

Quantity = -5

UI result:

Invoice saved successfully
```

This becomes part of the evidence bundle.

---

# 3. Network/API Evidence

GhostCrew should observe network traffic associated with the tested action.

For relevant requests, capture:

- HTTP method
- URL
- Relevant headers
- Request body
- Status code
- Response body
- Timing

Example:

```text
REQUEST

POST /api/invoices

{
  "quantity": "5",
  "price": 1000
}

RESPONSE

500

{
  "error": "Duplicate invoice"
}
```

---

# 4. Three-Way Contract Model

The central model of Phase 2 is:

```text
              UI
               │
               │
          User/Test Action
               │
               ↓
            REQUEST
               │
               ↓
            RESPONSE
               │
               ↓
          Final UI State
```

GhostCrew compares:

1. What was entered or shown in the UI
2. What the application sent
3. What the API returned
4. What the UI showed after the response

This is the core UI ↔ API intelligence capability.

---

# 5. Field Mapping

GhostCrew must determine which UI fields correspond to API payload fields.

Example:

```text
UI field:
Unit Price

API field:
unit_price
```

Another example:

```text
UI:
Quantity

API:
quantity
```

Use straightforward matching where possible.

When the mapping is ambiguous, Gemini should determine the most likely mapping using:

- Field label
- Input name
- Input ID
- Form context
- Payload structure
- Page context

The resulting mapping should be reusable for the same form.

---

# 6. Contract Checks

GhostCrew should detect the following contract mismatches.

## C1 — Missing Field

The UI contains a value but the request does not contain the corresponding field.

```text
UI:
Discount = 10%

Request:
No discount field
```

---

## C2 — Value Changed in Transit

The value sent to the API differs from the value entered or selected.

Examples:

```text
UI:
Quantity = 5

API:
quantity = "5"
```

or:

```text
UI:
Quantity = 5

API:
quantity = 50
```

---

## C3 — Unexpected Field

The API receives data that the user did not provide or edit.

Example:

```text
Request:
{
  "name": "John",
  "role": "admin"
}
```

when the form did not expose or authorize a role change.

---

## C4 — API Status vs UI Message Mismatch

Example:

```text
API:
500

UI:
Saved successfully
```

---

## C5 — Silent Failure

Example:

```text
API:
200

{
  "success": false
}

UI:
No error
```

---

## C6 — Response Not Reflected in UI

Example:

```text
API:
total = 1180

UI:
total = 1000
```

or:

```text
API:
new record created

UI:
record does not appear
```

---

## C7 — Stale UI

An update succeeds, but another visible part of the application continues showing old data.

---

## C8 — Client/Server Validation Gap

Example:

```text
UI:
Quantity -5 → blocked

API:
Quantity -5 → accepted
```

Or the reverse:

```text
UI:
Allows value

API:
Rejects value with an inappropriate/raw error
```

---

## C9 — Wrong Endpoint or Method

An update action accidentally calls a create endpoint or otherwise performs the wrong operation.

---

## C10 — Error Leakage

Detect responses or UI messages exposing information such as:

- Stack traces
- SQL details
- Internal file paths
- Internal implementation details

---

## C11 — Slow or Duplicate Calls

Detect:

- Multiple identical requests caused by one user action
- Unexpected repeated API calls
- Slow API calls above the configured threshold

Example:

```text
One click

POST /invoice
POST /invoice
POST /invoice

→ Potential duplicate submission
```

---

## C12 — Authentication/Role Gap

Detect cases where the UI prevents a lower-role user from performing an action but the corresponding API still accepts the operation.

---

# 7. API Replay

For relevant validation and authorization checks, GhostCrew should be able to take a captured request and test a controlled variation.

Example:

```text
Original request:

quantity = 5

        ↓

Replay variation:

quantity = -5

        ↓

API response
```

GhostCrew compares:

```text
UI verdict
vs
API verdict
```

This is particularly important for:

- Validation gaps
- Authorization gaps
- Security-related inconsistencies

---

# 8. Business Rules

GhostCrew should also evaluate application behavior against defined business rules.

Rules may describe:

- Invoice calculations
- Tax calculations
- Discounts
- Stock changes
- Approval requirements
- Ledger integrity
- Data relationships

Example:

```text
Expected:

invoice.total
=
sum(qty × price)
- discount
+ tax
```

GhostCrew compares the expected rule result with:

- UI values
- API response values

---

# 9. Data Integrity

GhostCrew should detect when an operation produces inconsistent application data.

Example:

```text
Before invoice:

Stock = 100

Invoice quantity:

10

Expected:

Stock = 90

Actual:

Stock = 100

❌ Data integrity issue
```

The finding should identify whether the inconsistency appears in:

- UI
- API
- Business-rule calculation
- Multiple layers

---

# 10. Gemini Reasoning

Gemini should be used where reasoning adds value.

Examples:

### Field mapping

```text
Which UI field corresponds to this payload field?
```

### Contract interpretation

```text
Does this request represent the user's intended action?
```

### Ambiguous behavior

```text
Is this behavior expected or suspicious?
```

### Root-cause explanation

```text
What is the most likely reason for this mismatch?
```

### Bug interpretation

```text
Given all evidence, does this represent a real defect?
```

Gemini should reason over structured evidence rather than receiving unnecessary full-page data.

---

# 11. Deterministic Checks vs AI Reasoning

The product should separate straightforward checks from reasoning.

### Deterministic

Use direct checks for:

- HTTP status
- Missing keys
- Extra keys
- Exact value differences
- Timing
- Duplicate requests
- Mathematical business rules
- Known validation constraints

### Gemini

Use Gemini for:

- Semantic field mapping
- Test-data generation
- Ambiguous interpretation
- Business-context reasoning
- Root-cause explanation
- Bug judgment
- Natural-language explanation

---

# 12. Finding Model

Phase 2 should produce structured findings that Phase 3 can consume.

Example:

```text
Potential Finding

Title:
Quantity accepted as negative value

Layer:
UI ↔ API

Page:
/invoices/new

Field:
quantity

Expected:
Quantity must be >= 0

Actual:
UI accepted -5
API accepted -5

Evidence:
Request
Response
Screenshot

Confidence:
0.91
```

---

# 13. Phase 2 Product Experience

The developer does not need to interact with a chatbot.

The intelligence operates automatically after GhostCrew performs a test.

```text
GhostCrew performs test
        ↓
Captures UI
        ↓
Captures API
        ↓
Compares evidence
        ↓
Checks business rules
        ↓
Gemini reasons
        ↓
Potential finding
```

---

# 14. Phase 2 Completion Criteria

Phase 2 is complete when GhostCrew can:

- Capture UI evidence
- Capture API requests and responses
- Map UI fields to payload fields
- Compare UI/request/response
- Detect C1–C12 contract problems
- Perform relevant API replay
- Evaluate business rules
- Detect data-integrity problems
- Use Gemini for semantic reasoning
- Produce structured potential-bug findings
- Provide enough evidence for Phase 3 to verify and present the issue

### Phase 2 statement

> **GhostCrew understands what happened inside the application and identifies inconsistencies between the UI, API and business rules.**

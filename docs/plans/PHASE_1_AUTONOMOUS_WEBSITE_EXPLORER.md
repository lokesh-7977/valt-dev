# GhostCrew — Phase 1: Autonomous Website Explorer

## Phase Objective

Build the first complete product capability of GhostCrew:

> **GhostCrew can enter a web application through the Chrome extension, understand what exists on the website, discover what can be tested, generate test data, and autonomously interact with forms and pages without waiting for the developer to perform the test.**

Phase 1 is owned by **Developer 1**.

The developer should not need to manually define every page, form, field, or test case for the core experience.

---

## 1. Product Scope

Phase 1 owns the complete **discovery and autonomous interaction** experience.

It includes:

1. Website auto-discovery
2. Page and navigation discovery
3. Form discovery
4. Field understanding
5. Action discovery
6. Test-data generation
7. Automatic form injection
8. Automatic form submission
9. Negative and boundary testing
10. Basic interaction/behavior testing
11. Basic page-health detection
12. Discovery/test progress visible in GhostCrew

---

# 2. Website Auto-Discovery

GhostCrew must be able to start from the application's base URL and independently understand the application.

### GhostCrew should discover

- Pages
- Routes
- Navigation menus
- Links
- Buttons that navigate
- SPA route changes
- Forms
- Input fields
- Dropdowns/selects
- Tables
- Lists
- Modals
- Action buttons
- Login pages
- Network activity associated with pages

### Example

```text
Developer opens application
        ↓
GhostCrew starts
        ↓
Discovers:
  Dashboard
  Customers
  Products
  Invoices
  Payments
  Settings
        ↓
Discovers:
  8 forms
  24 actions
  15 API interactions
```

The developer should not have to manually provide a list of pages for the basic discovery flow.

---

# 3. Page Understanding

For every discovered page, GhostCrew should understand and retain:

- URL
- Page title
- Visible structure
- Forms
- Fields
- Actions
- Tables/lists
- Relevant navigation
- Network activity
- Screenshot/evidence where applicable

GhostCrew should understand the page from the perspective of **what a QA agent can actually test**.

---

# 4. Form Discovery

Every discoverable form should become a potential GhostCrew test target.

For every form, identify:

- Form purpose
- Field name
- Field label
- Field type
- Required/optional status
- Minimum value
- Maximum value
- Maximum length
- Pattern/format
- Available options
- Relevant surrounding context

### Example

```text
Invoice Form

Customer
  Required
  Customer selector

Invoice Number
  Required
  Unique value

Quantity
  Required
  Integer

Unit Price
  Required
  Currency

Discount
  Optional
  Percentage

Invoice Date
  Required
  Date
```

---

# 5. Field Understanding

GhostCrew should understand what fields mean rather than treating every field as a generic text box.

Examples:

```text
"Email"       → email data
"Phone"       → phone data
"GSTIN"       → GSTIN-like data
"Quantity"    → numeric data
"Price"       → currency data
"Invoice Date"→ date data
"Customer"    → customer/entity selection
```

When the meaning is ambiguous, GhostCrew should use the available page context to determine the most appropriate interpretation.

---

# 6. Autonomous Test Data Generation

GhostCrew generates its own test data.

The developer should not need to manually populate the form before GhostCrew tests it.

## Happy-path data

Generate realistic valid values based on:

- Field labels
- Field types
- Page context
- Form context
- Available constraints

Example:

```text
Customer:
Acme Technologies Pvt Ltd

Quantity:
5

Unit Price:
₹1,250

Discount:
10%

Invoice Date:
Current valid date
```

---

# 7. Automatic Form Injection

This is a core requirement.

GhostCrew must automatically:

1. Find the form
2. Identify the fields
3. Generate the appropriate values
4. Fill the fields
5. Interact with controls
6. Submit the form
7. Observe the result

The developer does not have to click Submit for GhostCrew's autonomous test.

### Core loop

```text
Find form
    ↓
Understand fields
    ↓
Generate test data
    ↓
Fill form
    ↓
Submit
    ↓
Observe
    ↓
Record result
```

---

# 8. Validation Testing

GhostCrew should test more than the happy path.

For each relevant field, generate negative and boundary cases.

### Required-field cases

- Empty
- Whitespace-only

### Length cases

- Maximum length
- Maximum length + 1
- Very large input

### Numeric cases

- Negative
- Zero
- Minimum - 1
- Minimum
- Maximum
- Maximum + 1
- Decimal when integer is expected

### Format cases

- Invalid email
- Invalid phone
- Invalid date
- Invalid PAN/GST-style format
- Incorrect data type

### Special-input cases

- Unicode
- Emoji
- RTL text
- HTML/script-like strings
- SQL-like strings

### Business-input cases

- Duplicate unique value
- Invalid date relationship
- Past/future dates where inappropriate

---

# 9. Interaction Behaviour Testing

GhostCrew should also test application behavior around form interaction.

Examples:

### Double submission

```text
Click Submit twice
        ↓
Does application create two records?
```

### Browser back

```text
Submit
  ↓
Press Back
  ↓
Does application remain consistent?
```

### Reload

```text
Fill form
  ↓
Reload
  ↓
Does application behave correctly?
```

### Keyboard navigation

```text
Tab
 ↓
Field 1
 ↓
Field 2
 ↓
Field 3
```

GhostCrew should identify obvious broken interaction behavior.

---

# 10. Basic Page Health

While exploring the application, GhostCrew should also detect basic page-health problems.

### Detect

- Console errors
- Unhandled promise errors
- Failed network requests
- Broken links
- Broken images
- Slow pages
- Horizontal overflow
- Overlapping elements
- Cut-off text
- Inputs without labels
- Buttons without meaningful text
- Basic accessibility problems

These findings should become evidence that can be consumed by the later verification/reporting phase.

---

# 11. Safe Exploration

GhostCrew should explore autonomously while avoiding destructive actions by default.

Examples of destructive actions:

- Delete
- Pay
- Send email
- Irreversible submission
- Similar destructive operations

The default behavior is:

```text
Destructive action
       ↓
Do not execute automatically
```

An explicit developer-controlled option may allow destructive actions.

---

# 12. Discovery Boundaries

Autonomous exploration should remain bounded.

The product must support limits such as:

- Maximum exploration depth
- Duplicate URL handling
- Repeated-page prevention
- Duplicate test prevention
- Safe action handling

For dynamic URLs, equivalent routes should be recognized as the same logical page where appropriate.

Example:

```text
/invoice/12
/invoice/13
/invoice/14

        ↓

/invoice/:id
```

---

# 13. Phase 1 Product Experience

The Chrome extension should make the autonomous activity visible.

Example:

```text
GhostCrew is working...

✓ Discovered Dashboard
✓ Discovered Customers
✓ Discovered Products
✓ Found Invoice form
⚡ Generating test data
⚡ Testing Invoice form
   Case 12/32
```

The user should understand that GhostCrew is actively working in the background.

---

# 14. Phase 1 Completion Criteria

Phase 1 is complete when GhostCrew can:

- Start from a web application
- Discover reachable pages
- Understand forms and fields
- Identify actionable elements
- Generate realistic test data
- Automatically fill forms
- Automatically submit forms
- Run valid and invalid test cases
- Test basic interaction behavior
- Detect basic page-health problems
- Avoid destructive actions by default
- Show live discovery/testing progress

### Phase 1 statement

> **GhostCrew can autonomously explore a web application and test its forms without requiring the developer to manually define or execute the tests.**

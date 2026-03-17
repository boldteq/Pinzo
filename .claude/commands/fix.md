Fix this issue in the Zip Code Checker Shopify app: $ARGUMENTS

## Smart Routing

Before diving in, classify the bug and route to the right agent:

| Bug type | Route to |
|---|---|
| TypeScript / build errors | **bug-fixer** agent |
| Runtime errors / crashes | **bug-fixer** agent |
| Auth / session issues | **bug-fixer** agent (Category A) |
| Prisma / DB errors | **bug-fixer** agent (Category D) |
| Shopify API errors | **bug-fixer** agent (Category E) |
| Webhook failures | **bug-fixer** agent (Category F) |
| Widget not rendering | **widget-specialist** agent |
| Public API returning wrong data | **widget-specialist** agent |
| CORS / CSP errors | **widget-specialist** agent |
| Polaris component visual bugs | **bug-fixer** agent (Category C) |
| Billing / subscription issues | **bug-fixer** agent (Category G) |
| Complex multi-system bug | Start with **bug-fixer**, hand off as needed |

## Debugging Process (Follow Exactly)

### Step 1 — Locate the Issue
- Find all files related to the error (route file, server file, Prisma schema)
- Read the FULL file where the error originates — understand context before changing anything
- Check the exact error message and stack trace
- Run `npm run typecheck` to see all TypeScript errors at once

### Step 2 — Classify Using Bug-Fixer Categories
Use the bug-fixer agent's diagnostic categories (A through G) to systematically check root causes. The most common:

**Auth issues (70% of Shopify bugs):**
- Is `authenticate.admin(request)` called before every Shopify API usage?
- Is `session.shop` being used to scope DB queries?
- Is the route missing auth (public routes `api.*` should NOT use admin auth)?

**TypeScript errors:**
- Run `npm run typecheck` to see all errors at once
- Check Prisma-generated types match usage
- Check React Router `useLoaderData<typeof loader>()` type inference
- React Router 7 imports from `react-router`, NOT `@remix-run/react`

**Polaris component errors:**
- Check Polaris v13 prop names — many changed from v12
- Check `.d.ts` files in `node_modules/@shopify/polaris/build/ts/src/components/`
- `Badge`/`Banner`: `status` → `tone` in v13

**Prisma/DB errors:**
- Check unique constraints: ZipCode `[shop, zipCode]`, WidgetConfig `shop`
- Use `upsert` for singleton records
- Run `npx prisma migrate dev` if schema changed without migration

**Webhook errors:**
- Must return 200 status always — even on internal errors
- Must be idempotent
- GDPR webhooks: `customers/data_request`, `customers/redact`, `shop/redact`

### Step 3 — Read Before Fixing
Always read the full file before editing. Understand surrounding code context. Match existing patterns exactly.

### Step 4 — Fix (Minimal, Targeted)
- Fix ONLY what is broken — never refactor working code while fixing a bug
- If fixing a TypeScript error, don't change logic
- If fixing a logic bug, don't change types
- Make the smallest change that fixes the issue
- No `// @ts-ignore` or `as any` — fix the root cause

### Step 5 — Verify
- Run `npm run typecheck` — confirm ZERO errors (not just fewer)
- Confirm the fix does not break adjacent functionality
- For Prisma changes: check if migration is needed
- Verify auth scoping is intact

### Step 6 — Report
```
## Bug Fix Report
**Root cause**: [1 sentence]
**Category**: [A-G]
**Files changed**: [file:line_range for each]
**Fix applied**: [what changed and why]
**Verification**: `npm run typecheck` — 0 errors
**Follow-up needed**: [migration, env var, Shopify partner dashboard, or "none"]
**Recommended next**: Run `/review` to check for regressions
```

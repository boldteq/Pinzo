Review the most recent changes in the Zip Code Checker Shopify app.

## Review Strategy

This is the quality gate. Run this after any feature build or bug fix to catch regressions and ensure Shopify ecosystem compliance.

### Phase 1 — Automated Checks
Run these commands first and report results:
1. `npm run typecheck` — must be ZERO errors
2. `npm run lint` — check for linting issues

### Phase 2 — Security Audit (Critical — Report Every Violation)

#### Auth & Data Isolation
1. **Auth missing** — any `app.*` route without `authenticate.admin(request)` at the top of loader/action
2. **Cross-shop data leak** — any DB query missing `where: { shop: session.shop }`
3. **Public route with admin auth** — any `api.*` route that accidentally uses `authenticate.admin`
4. **Exposed secrets** — any session tokens, API keys, or internal IDs in public API responses

#### Input Validation
5. **Unsanitized input** — public API endpoints without `shop` parameter validation
6. **Missing CORS** — public API responses without `Access-Control-Allow-Origin` headers
7. **SQL/Prisma injection** — user input passed directly to queries without sanitization

### Phase 3 — Shopify Ecosystem Compliance

#### Architecture
1. **Shopify API in components** — any GraphQL/REST calls outside loader/action functions
2. **Raw fetch for Shopify API** — using `fetch()` instead of `admin.graphql()` from authenticated client
3. **Missing idempotency** — webhook handlers that don't check for existing records before creating

#### Polaris v13 Compliance
4. **Raw HTML layout** — `<div>`, `<p>`, `<h1>`, `<table>` used instead of Polaris components
5. **Missing loading states** — forms that submit without SkeletonPage during navigation
6. **Missing empty states** — list/table views without EmptyState component for zero items
7. **Missing Toast feedback** — mutations (create/update/delete) without success/error Toast
8. **Missing error Banner** — actions without try/catch or without error display to user

#### Billing
9. **Ungated premium features** — features that should check subscription plan but don't
10. **Direct billing API calls** — billing logic outside of `billing.server.ts`

### Phase 4 — Code Quality

1. **TypeScript `any`** — any explicit `any` type or unsafe type assertion
2. **Console.log in production** — any `console.log` left in committed code
3. **TODO/FIXME comments** — any placeholder comments that should have been resolved
4. **Hardcoded values** — shop names, API keys, or test data in production code
5. **Remix imports** — imports from `@remix-run/react` instead of `react-router`
6. **Missing error handling** — async operations without try/catch

### Phase 5 — API Contract Validation (If Public APIs Changed)
- Verify response shapes match documented contracts
- Verify error responses include proper status codes and messages
- Verify CORS headers on all responses including errors
- Verify shop parameter validation on every endpoint

## Output Format

```
## Review Results

### Automated Checks
- TypeCheck: PASS/FAIL (X errors)
- Lint: PASS/FAIL (X warnings)

### Critical Issues (Must Fix)
[numbered list — file:line, what's wrong, how to fix]

### Quality Issues (Should Fix)
[numbered list — file:line, what's wrong, how to fix]

### Billing/Plan Issues
[numbered list or "None found"]

### Summary
- Total critical: X
- Total quality: X
- Recommendation: [SHIP IT / FIX CRITICAL FIRST / NEEDS REWORK]
```

## Files to Check
Focus on recently modified files (use `git diff` and `git status`). Also spot-check:
- Any new `app.*.tsx` routes
- Any new `api.*.tsx` routes
- Any changes to `prisma/schema.prisma`
- Any changes to `billing.server.ts` or `plans.ts`
- Any changes to widget-related files

## Collaboration
- If critical issues found → recommend `/fix [issue description]` to route to bug-fixer
- If missing features found → recommend `/feature [description]` to route to builder
- If widget issues found → flag for widget-specialist agent

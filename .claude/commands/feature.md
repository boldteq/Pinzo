Build a complete feature for the Zip Code Checker Shopify app: $ARGUMENTS

## Agent Orchestration

You are the orchestrator. Route work to the right agent based on what's needed:

| What's needed | Agent to use |
|---|---|
| New admin page, route, component | **builder** |
| New/modified public API endpoint | **widget-specialist** |
| Storefront widget changes | **widget-specialist** |
| Database schema changes | Handle directly (see Step 5) |
| TypeScript errors during build | **bug-fixer** |
| Multiple domains involved | Spawn agents in parallel |

**Parallel execution**: If the feature needs both an admin page AND an API endpoint, spawn the builder and widget-specialist agents concurrently. They'll coordinate via the API contract.

## Your Process (Follow Exactly)

### Step 1 — Read the Rules
Read CLAUDE.md at the project root. Understand the stack: React Router 7, Polaris v13, Prisma, `@shopify/shopify-app-react-router`.

### Step 2 — Understand Existing Patterns
Read at least 2 of these files to match the exact code patterns:
- `app/routes/app.zip-codes.tsx` — CRUD list with modal and bulk actions
- `app/routes/app.delivery-rules.tsx` — complex form with validation
- `app/routes/app.settings.tsx` — settings form
- `app/routes/app.widget.tsx` — configuration form with live preview
- `app/routes/app.pricing.tsx` — billing/plan UI
- `app/routes/api.zip-check.tsx` — public API endpoint

### Step 3 — Plan Before Building
Before writing code, create a brief plan:
1. What route type? (admin page / public API / webhook)
2. What Prisma models are involved? (existing or new?)
3. What's the data flow? (loader fetches → component renders → action mutates)
4. Does this need billing/plan gating?
5. Does this touch the storefront widget?

### Step 4 — Identify the Route Type
- Admin page → `app/routes/app.[name].tsx` (requires `authenticate.admin`)
- Public API → `app/routes/api.[name].tsx` (returns JSON, no admin auth, needs CORS)
- Webhook → `app/routes/webhooks.[topic].tsx` (idempotent, return 200)

### Step 5 — Database Changes (If Needed)
1. Read `prisma/schema.prisma`
2. Add new model or fields
3. Run `npx prisma migrate dev --name [descriptive_name]`
4. Run `npx prisma generate`
5. Update TypeScript types that reference changed models

### Step 6 — Build the Route File
Structure every admin route with this exact pattern:
```tsx
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@shopify/shopify-app-react-router";
import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
// Polaris imports...

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  // fetch data from db using session.shop
  return json({ ... });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  try {
    // handle form mutations
    return json({ success: true, message: "Done" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "An unexpected error occurred";
    return json({ error: msg }, { status: 500 });
  }
}

export default function FeaturePage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";
  // Polaris UI only — Page > Layout > Card > BlockStack
  // Toast for feedback, SkeletonPage for loading, EmptyState for empty lists
}
```

### Step 7 — Polaris UI Requirements (Strict)
- Wrap page in `<Page title="...">` with `<Layout>` inside
- Add `<Toast>` for success/error feedback after every mutation
- Add `<SkeletonPage>` for loading states during navigation
- Add `<EmptyState>` for when lists have zero items — with illustration and CTA
- Forms use `<Form method="post">` with Polaris `<FormLayout>`
- Tables use `<IndexTable>` (preferred) or `<DataTable>`
- Confirmations use `<Modal>` for destructive actions
- Use `<Banner>` for persistent warnings/info
- NO raw HTML elements (`<div>`, `<p>`, `<h1>`, `<table>`) for layout

### Step 8 — Quality Gates (ALL must pass)
1. Run `npm run typecheck` — fix EVERY error, zero tolerance
2. Verify `authenticate.admin(request)` in every admin route loader/action
3. Verify `where: { shop: session.shop }` on every DB query
4. Verify try/catch in every action
5. Verify Toast feedback exists for every mutation
6. Verify SkeletonPage loading state exists
7. Verify EmptyState exists for every list view
8. If public API: verify CORS headers, shop validation, input sanitization

### Step 9 — Report
Provide a structured completion report:
```
## Feature Complete: [Feature Name]
**Files created/modified**: [list with paths]
**Database changes**: [migration name or "none"]
**API endpoints**: [URL, method, params — if any]
**Plan gating**: [which plan required, or "none"]
**How to test**:
1. [step-by-step test instructions]
2. ...
**Recommended next**: Run `/review` to validate
```

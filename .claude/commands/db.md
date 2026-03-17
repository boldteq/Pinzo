Handle this database task for the Zip Code Checker Shopify app: $ARGUMENTS

## Database Context

**ORM:** Prisma v6
**Dev DB:** SQLite (`prisma/dev.db`)
**Prod DB:** PostgreSQL (via `DATABASE_URL` env var)
**Client:** Singleton in `app/db.server.ts`

## Collaboration Protocol

After any schema change, notify other agents:
- **Builder**: New models/fields may need admin UI routes
- **Widget-specialist**: New fields in ZipCode, DeliveryRule, or WidgetConfig affect the public API response
- **Bug-fixer**: Schema changes can cause TypeScript errors in existing routes

## Models Reference
- **ZipCode** — `id, shop, zipCode, label, zone, message, eta, type, createdAt, updatedAt` | unique: `[shop, zipCode]`
- **DeliveryRule** — `id, shop, name, zone, zipCodes, minOrderAmount, deliveryFee, freeShippingAbove, estimatedDays, cutoffTime, daysOfWeek, priority, createdAt, updatedAt`
- **WaitlistEntry** — `id, shop, email, zipCode, note, status, createdAt, updatedAt` | unique: `[shop, email, zipCode]`
- **WidgetConfig** — `id, shop, position, primaryColor, successColor, errorColor, backgroundColor, textColor, heading, placeholder, buttonText, ...` | unique: `shop`
- **Subscription** — `id, shop, planId, billingInterval, shopifySubscriptionId, status, trialEndsAt, createdAt, updatedAt` | unique: `shop`
- **Session** — Shopify session storage (DO NOT modify)

## Process

### For Schema Changes
1. Read `prisma/schema.prisma` first — understand current state
2. Plan the change — add fields, new model, index, or relation
3. Edit `prisma/schema.prisma`
4. Run `npx prisma migrate dev --name [descriptive_name]`
5. Run `npx prisma generate` (to update TypeScript types)
6. Update any route files that reference changed models
7. Run `npm run typecheck` — fix any type errors from schema changes

### For Query Optimization
1. Check existing queries in route files
2. Add indexes for frequently queried fields
3. Use `select` to fetch only needed fields (not full records)
4. Use `include` sparingly — avoid N+1 queries
5. Use `db.$transaction()` for multi-step operations

### For Data Operations
1. Always include `where: { shop: session.shop }` for security
2. Use `upsert` for singleton records (WidgetConfig, Subscription)
3. Use `createMany` for bulk inserts (ZIP code imports)
4. Use `deleteMany` for bulk deletes with proper `where` clause
5. Use transactions for multi-step operations: `db.$transaction([...])`

### Query Patterns
```tsx
// Singleton upsert (WidgetConfig, Subscription)
await db.widgetConfig.upsert({
  where: { shop: session.shop },
  update: { ...configData },
  create: { shop: session.shop, ...configData },
});

// Paginated list
const [items, total] = await db.$transaction([
  db.zipCode.findMany({
    where: { shop: session.shop },
    skip: (page - 1) * pageSize,
    take: pageSize,
    orderBy: { createdAt: "desc" },
  }),
  db.zipCode.count({ where: { shop: session.shop } }),
]);

// Bulk import with conflict handling
await db.zipCode.createMany({
  data: zipCodes.map(zc => ({ shop: session.shop, ...zc })),
  skipDuplicates: true,
});

// Safe delete (verify ownership)
await db.zipCode.deleteMany({
  where: { id: { in: ids }, shop: session.shop },
});
```

### SQLite vs PostgreSQL Gotchas
- SQLite: no `ENUM` type — use string fields with application-level validation
- SQLite: no `@db.Text` — just use `String`
- PostgreSQL: use `@db.Text` for long strings (customCss, messages)
- Both: `DateTime` defaults work, but format differs — Prisma handles this
- Migrations: test on SQLite in dev, but be aware PostgreSQL may need different migration

### Caution Rules
- NEVER run `npx prisma migrate reset` without explicit user confirmation — it deletes ALL data
- NEVER modify `Session` model — it's managed by `@shopify/shopify-app-session-storage-prisma`
- Always check existing migrations before creating new ones
- Always back up dev.db before destructive operations
- After schema changes, always run typecheck to catch broken references

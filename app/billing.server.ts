import db from "./db.server";
import {
  ALL_PAID_PLANS,
  PLAN_FREE,
  getPlanTier,
  PLAN_LIMITS,
  type PlanTier,
  type PlanLimits,
} from "./plans";

export type { PlanTier };

export interface ShopSubscription {
  planId: string;
  planTier: PlanTier;
  billingInterval: string;
  shopifySubscriptionId: string | null;
  status: string;
  trialEndsAt: Date | null;
  limits: PlanLimits;
}

/**
 * Get (or create) the subscription record for a shop from the DB.
 */
export async function getShopSubscription(
  shop: string,
): Promise<ShopSubscription> {
  const sub = await db.subscription.upsert({
    where: { shop },
    update: {},
    create: {
      shop,
      planId: PLAN_FREE,
      billingInterval: "monthly",
      status: "active",
    },
  });

  const planTier = getPlanTier(sub.planId) ;
  return {
    planId: sub.planId,
    planTier,
    billingInterval: sub.billingInterval,
    shopifySubscriptionId: sub.shopifySubscriptionId,
    status: sub.status,
    trialEndsAt: sub.trialEndsAt,
    limits: PLAN_LIMITS[planTier],
  };
}

/**
 * Sync the subscription from Shopify billing check result into our DB.
 * Returns the updated ShopSubscription.
 */
export async function syncSubscriptionFromShopify(
  shop: string,
  appSubscriptions: Array<{
    id: string;
    name: string;
    status: string;
    trialDays?: number | null;
    createdAt?: string | null;
  }>,
): Promise<ShopSubscription> {
  const activeSub = appSubscriptions.find((s) => s.status === "ACTIVE");
  const frozenSub = !activeSub
    ? appSubscriptions.find((s) => s.status === "FROZEN")
    : undefined;
  const pendingSub = !activeSub && !frozenSub
    ? appSubscriptions.find((s) => s.status === "PENDING")
    : undefined;

  const matchedSub = activeSub ?? frozenSub ?? pendingSub ?? null;

  let planId = PLAN_FREE;
  let billingInterval = "monthly";
  let shopifySubscriptionId: string | null = null;
  let status = "active";
  let trialEndsAt: Date | null = null;

  if (matchedSub) {
    // For FROZEN/PENDING keep the plan but reflect the real status.
    // For ACTIVE, this is the normal path.
    planId = matchedSub.name;
    shopifySubscriptionId = matchedSub.id;
    status = matchedSub.status.toLowerCase();
    billingInterval =
      planId.toLowerCase().includes("annual") ? "annual" : "monthly";

    // Compute trialEndsAt when trial information is available from Shopify
    if (
      matchedSub.trialDays != null &&
      matchedSub.trialDays > 0 &&
      matchedSub.createdAt
    ) {
      const createdMs = new Date(matchedSub.createdAt).getTime();
      if (!isNaN(createdMs)) {
        trialEndsAt = new Date(
          createdMs + matchedSub.trialDays * 24 * 60 * 60 * 1000,
        );
      }
    }
  }

  const planTier = getPlanTier(planId);

  // Build the upsert update payload — only overwrite trialEndsAt when we have
  // a non-null value; never null-out an existing trial end date.
  const upsertUpdate: {
    planId: string;
    billingInterval: string;
    shopifySubscriptionId: string | null;
    status: string;
    trialEndsAt?: Date;
  } = {
    planId,
    billingInterval,
    shopifySubscriptionId,
    status,
  };
  if (trialEndsAt !== null) {
    upsertUpdate.trialEndsAt = trialEndsAt;
  }

  await db.subscription.upsert({
    where: { shop },
    create: {
      shop,
      planId,
      billingInterval,
      shopifySubscriptionId,
      status,
      ...(trialEndsAt !== null ? { trialEndsAt } : {}),
    },
    update: upsertUpdate,
  });

  // Retrieve the current trialEndsAt from DB in case we didn't overwrite it
  const persisted = await db.subscription.findUnique({ where: { shop } });

  return {
    planId,
    planTier,
    billingInterval,
    shopifySubscriptionId,
    status,
    trialEndsAt: persisted?.trialEndsAt ?? null,
    limits: PLAN_LIMITS[planTier],
  };
}

/**
 * Cancel subscription for a shop and revert to free.
 */
export async function cancelShopSubscription(shop: string): Promise<void> {
  await db.subscription.upsert({
    where: { shop },
    create: {
      shop,
      planId: PLAN_FREE,
      billingInterval: "monthly",
      shopifySubscriptionId: null,
      status: "active",
    },
    update: {
      planId: PLAN_FREE,
      billingInterval: "monthly",
      shopifySubscriptionId: null,
      status: "active",
    },
  });
}

/**
 * Returns all Shopify plan names as strings for billing.check().
 */
export { ALL_PAID_PLANS };

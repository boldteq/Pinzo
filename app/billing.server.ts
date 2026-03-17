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
  appSubscriptions: Array<{ id: string; name: string; status: string }>,
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

  if (matchedSub) {
    // For FROZEN/PENDING keep the plan but reflect the real status.
    // For ACTIVE, this is the normal path.
    planId = matchedSub.name;
    shopifySubscriptionId = matchedSub.id;
    status = matchedSub.status.toLowerCase();
    billingInterval =
      planId.toLowerCase().includes("annual") ? "annual" : "monthly";
  }

  const planTier = getPlanTier(planId) ;

  await db.subscription.upsert({
    where: { shop },
    create: {
      shop,
      planId,
      billingInterval,
      shopifySubscriptionId,
      status,
    },
    update: {
      planId,
      billingInterval,
      shopifySubscriptionId,
      status,
    },
  });

  return {
    planId,
    planTier,
    billingInterval,
    shopifySubscriptionId,
    status,
    trialEndsAt: null,
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

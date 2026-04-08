// Shared plan constants — safe for both client and server

/**
 * Sentinel value used in place of Infinity for "unlimited" plan limits.
 * Infinity cannot be serialized to JSON (becomes null), so we use this
 * large number as the canonical "no limit" value. All limit comparisons
 * should use isUnlimited() or compare against UNLIMITED.
 */
export const UNLIMITED = 999999;

export const PLAN_FREE = "free";
export const PLAN_STARTER_MONTHLY = "Starter Monthly";
export const PLAN_STARTER_ANNUAL = "Starter Annual";
export const PLAN_PRO_MONTHLY = "Pro Monthly";
export const PLAN_PRO_ANNUAL = "Pro Annual";
export const PLAN_ULTIMATE_MONTHLY = "Ultimate Monthly";
export const PLAN_ULTIMATE_ANNUAL = "Ultimate Annual";

export const ALL_PAID_PLANS = [
  PLAN_STARTER_MONTHLY,
  PLAN_STARTER_ANNUAL,
  PLAN_PRO_MONTHLY,
  PLAN_PRO_ANNUAL,
  PLAN_ULTIMATE_MONTHLY,
  PLAN_ULTIMATE_ANNUAL,
];

export type PlanTier = "free" | "starter" | "pro" | "ultimate";

export interface PlanLimits {
  maxZipCodes: number;
  allowBlocked: boolean;
  maxDeliveryRules: number;
  maxWaitlist: number;
  csvImport: boolean;
  csvExport: boolean;
  widgetBasicCustom: boolean;
  widgetFullCustom: boolean;
  showEtaCodReturn: boolean;
  cartBlocking: boolean;
  customCss: boolean;
  productCollectionRules: boolean;
  label: string;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    maxZipCodes: 20,
    allowBlocked: false,
    maxDeliveryRules: 0,
    maxWaitlist: 0,
    csvImport: false,
    csvExport: false,
    widgetBasicCustom: true,
    widgetFullCustom: false,
    showEtaCodReturn: false,
    cartBlocking: false,
    customCss: false,
    productCollectionRules: false,
    label: "Free",
  },
  starter: {
    maxZipCodes: 500,
    allowBlocked: true,
    maxDeliveryRules: 3,
    maxWaitlist: 50,
    csvImport: true,
    csvExport: false,
    widgetBasicCustom: true,
    widgetFullCustom: true,
    showEtaCodReturn: true,
    cartBlocking: false,
    customCss: false,
    productCollectionRules: false,
    label: "Starter",
  },
  pro: {
    maxZipCodes: UNLIMITED,
    allowBlocked: true,
    maxDeliveryRules: UNLIMITED,
    maxWaitlist: UNLIMITED,
    csvImport: true,
    csvExport: true,
    widgetBasicCustom: true,
    widgetFullCustom: true,
    showEtaCodReturn: true,
    cartBlocking: true,
    customCss: false,
    productCollectionRules: true,
    label: "Pro",
  },
  ultimate: {
    maxZipCodes: UNLIMITED,
    allowBlocked: true,
    maxDeliveryRules: UNLIMITED,
    maxWaitlist: UNLIMITED,
    csvImport: true,
    csvExport: true,
    widgetBasicCustom: true,
    widgetFullCustom: true,
    showEtaCodReturn: true,
    cartBlocking: true,
    customCss: true,
    productCollectionRules: true,
    label: "Ultimate",
  },
};

export function getPlanTier(planName: string): PlanTier {
  if (planName === PLAN_STARTER_MONTHLY || planName === PLAN_STARTER_ANNUAL)
    return "starter";
  if (planName === PLAN_PRO_MONTHLY || planName === PLAN_PRO_ANNUAL)
    return "pro";
  if (planName === PLAN_ULTIMATE_MONTHLY || planName === PLAN_ULTIMATE_ANNUAL)
    return "ultimate";
  return "free";
}

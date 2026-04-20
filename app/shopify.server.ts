import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
// ApiVersion.January26 = "2026-01" — matches shopify.app.toml
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import {
  PLAN_STARTER_MONTHLY,
  PLAN_STARTER_ANNUAL,
  PLAN_PRO_MONTHLY,
  PLAN_PRO_ANNUAL,
  PLAN_ULTIMATE_MONTHLY,
  PLAN_ULTIMATE_ANNUAL,
} from "./plans";

// Fail fast at boot if critical env vars are missing. A silent default ("" for
// apiSecretKey, undefined SCOPES) would cause OAuth to fail with opaque errors
// later in request handling — much harder to debug in production.
const REQUIRED_ENV_VARS = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "SCOPES",
] as const;
const missingEnv = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  throw new Error(
    `Missing required Shopify env vars: ${missingEnv.join(", ")}. Check Railway env config.`,
  );
}

const SHOP_CUSTOM_DOMAIN = process.env.SHOP_CUSTOM_DOMAIN;
const CUSTOM_DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
if (SHOP_CUSTOM_DOMAIN && !CUSTOM_DOMAIN_RE.test(SHOP_CUSTOM_DOMAIN)) {
  throw new Error(
    `SHOP_CUSTOM_DOMAIN="${SHOP_CUSTOM_DOMAIN}" is not a valid domain.`,
  );
}

// Re-export plan helpers so server code can import from one place
export {
  PLAN_FREE,
  PLAN_STARTER_MONTHLY,
  PLAN_STARTER_ANNUAL,
  PLAN_PRO_MONTHLY,
  PLAN_PRO_ANNUAL,
  PLAN_ULTIMATE_MONTHLY,
  PLAN_ULTIMATE_ANNUAL,
  ALL_PAID_PLANS,
  PLAN_LIMITS,
  getPlanTier,
} from "./plans";
export type { PlanTier, PlanLimits } from "./plans";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: ApiVersion.January26,
  scopes: process.env.SCOPES!.split(","),
  appUrl: process.env.SHOPIFY_APP_URL!,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  billing: {
    [PLAN_STARTER_MONTHLY]: {
      lineItems: [
        {
          amount: 4.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
      trialDays: 7,
    },
    [PLAN_STARTER_ANNUAL]: {
      lineItems: [
        {
          amount: 39.0,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
      trialDays: 7,
    },
    [PLAN_PRO_MONTHLY]: {
      lineItems: [
        {
          amount: 9.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
      trialDays: 7,
    },
    [PLAN_PRO_ANNUAL]: {
      lineItems: [
        {
          amount: 79.0,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
      trialDays: 7,
    },
    [PLAN_ULTIMATE_MONTHLY]: {
      lineItems: [
        {
          amount: 19.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
      trialDays: 7,
    },
    [PLAN_ULTIMATE_ANNUAL]: {
      lineItems: [
        {
          amount: 149.0,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
      trialDays: 7,
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
  ...(SHOP_CUSTOM_DOMAIN ? { customShopDomains: [SHOP_CUSTOM_DOMAIN] } : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

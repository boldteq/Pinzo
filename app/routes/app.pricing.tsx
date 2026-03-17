import { useState, useEffect, useCallback } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useNavigate, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  PLAN_STARTER_MONTHLY,
  PLAN_STARTER_ANNUAL,
  PLAN_PRO_MONTHLY,
  PLAN_PRO_ANNUAL,
  PLAN_ULTIMATE_MONTHLY,
  PLAN_ULTIMATE_ANNUAL,
} from "../plans";
import {
  cancelShopSubscription,
  getShopSubscription,
} from "../billing.server";
import db from "../db.server";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  ButtonGroup,
  Divider,
  Box,
  Banner,
  Icon,
  Modal,
  InlineGrid,
} from "@shopify/polaris";
import { CheckCircleIcon, StarIcon } from "@shopify/polaris-icons";

// ─── Plan data ────────────────────────────────────────────────────────────────

const PLANS_DATA = {
  free: {
    id: "free",
    name: "Free",
    monthlyPrice: 0,
    annualPrice: 0,
    annualMonthlyPrice: 0,
    description: "Get started and try it out",
    features: [
      "Up to 20 zip codes",
      "Allowed zip codes only",
      "Basic storefront widget",
      "Unlimited searches",
      "Standard email support",
    ],
    shopifyPlanMonthly: null as string | null,
    shopifyPlanAnnual: null as string | null,
  },
  starter: {
    id: "starter",
    name: "Starter",
    monthlyPrice: 4.99,
    annualPrice: 39,
    annualMonthlyPrice: 3.25,
    description: "Essential features for small stores",
    features: [
      "Up to 500 zip codes",
      "Delivery ETA & COD info",
      "Full widget customization",
      "Zone-based organization",
      "3 delivery rules",
      "Waitlist (25 entries)",
      "CSV import",
      "Unlimited searches",
    ],
    shopifyPlanMonthly: PLAN_STARTER_MONTHLY,
    shopifyPlanAnnual: PLAN_STARTER_ANNUAL,
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyPrice: 9.99,
    annualPrice: 79,
    annualMonthlyPrice: 6.58,
    description: "For growing stores that need full control",
    features: [
      "Unlimited zip codes",
      "Allowed + Blocked zip codes",
      "Unlimited delivery rules",
      "Full customer waitlist",
      "Bulk CSV import & export",
      "Cart & checkout blocking",
      "Priority email support",
    ],
    shopifyPlanMonthly: PLAN_PRO_MONTHLY,
    shopifyPlanAnnual: PLAN_PRO_ANNUAL,
    bestValue: true,
  },
  ultimate: {
    id: "ultimate",
    name: "Ultimate",
    monthlyPrice: 19.99,
    annualPrice: 149,
    annualMonthlyPrice: 12.42,
    description: "Enterprise-grade power and flexibility",
    features: [
      "Everything in Pro",
      "Custom widget CSS",
      "API access",
      "24/7 VIP support",
      "Early access to new features",
    ],
    shopifyPlanMonthly: PLAN_ULTIMATE_MONTHLY,
    shopifyPlanAnnual: PLAN_ULTIMATE_ANNUAL,
  },
};

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const subscription = await getShopSubscription(shop);
  return { subscription };
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs): Promise<
  | { error: string }
  | { success: boolean; message: string }
  | null
> => {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  if (intent === "subscribe") {
    const plan = String(formData.get("plan"));
    const returnUrl = `${process.env.SHOPIFY_APP_URL}/app/pricing`;
    try {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      // billing.request() throws a redirect Response to Shopify's
      // billing confirmation page — we must let it propagate.
      await billing.request({
        plan: plan as any,
        isTest: process.env.NODE_ENV !== "production",
        returnUrl,
      });
      /* eslint-enable @typescript-eslint/no-explicit-any */
      return null;
    } catch (error) {
      // Re-throw Response redirects so React Router / App Bridge handles them
      if (error instanceof Response) throw error;
      // BillingError has errorData with Shopify userErrors
      const errorData = (error as { errorData?: Array<{ field?: string; message?: string }> }).errorData;
      const details = errorData?.map((e) => e.message).join(", ");
      const message = details || (error instanceof Error ? error.message : String(error));

      // Provide a helpful message for common billing errors
      if (message.includes("Custom apps cannot use the Billing API")) {
        return {
          error: "Billing is not available for custom apps. Please change your app distribution to 'Public' in the Shopify Partner Dashboard.",
        };
      }
      return {
        error: `Failed to initiate subscription: ${message}`,
      };
    }
  }

  // Set plan directly in database (for custom apps where Billing API is unavailable)
  if (intent === "test-set-plan") {
    const tier = String(formData.get("tier")) as import("../plans").PlanTier;
    const validTiers = ["free", "starter", "pro", "ultimate"];
    if (!validTiers.includes(tier)) {
      return { error: `Invalid plan tier: ${tier}` };
    }
    const planId = tier === "free" ? "free" : `${tier.charAt(0).toUpperCase() + tier.slice(1)} Monthly`;
    await db.subscription.upsert({
      where: { shop },
      create: { shop, planId, billingInterval: "monthly", status: "active" },
      update: { planId, billingInterval: "monthly", status: "active", shopifySubscriptionId: null },
    });
    return { success: true, message: `Plan set to ${tier.charAt(0).toUpperCase() + tier.slice(1)}.` };
  }

  if (intent === "cancel") {
    try {
      const sub = await getShopSubscription(shop);
      if (sub.shopifySubscriptionId) {
        await billing.cancel({
          subscriptionId: sub.shopifySubscriptionId,
          isTest: process.env.NODE_ENV !== "production",
          prorate: true,
        });
      }
      await cancelShopSubscription(shop);
      return {
        success: true,
        message: "Subscription cancelled. You are now on the Free plan.",
      };
    } catch {
      return { error: "Failed to cancel subscription. Please try again." };
    }
  }

  return null;
};

// ─── Feature row ─────────────────────────────────────────────────────────────

function PlanFeature({ feature }: { feature: string }) {
  return (
    <InlineStack gap="200" blockAlign="start" wrap={false}>
      <Box>
        <Icon source={CheckCircleIcon} tone="success" />
      </Box>
      <Text as="span" variant="bodyMd">
        {feature}
      </Text>
    </InlineStack>
  );
}

// ─── Plan card ────────────────────────────────────────────────────────────────

type PlanCardProps = {
  plan: (typeof PLANS_DATA)[keyof typeof PLANS_DATA];
  isAnnual: boolean;
  currentTier: string;
  onSubscribe: (planName: string) => void;
  onRequestCancel: () => void;
  loadingPlan: string | null;
};

function PlanCard({
  plan,
  isAnnual,
  currentTier,
  onSubscribe,
  onRequestCancel,
  loadingPlan,
}: PlanCardProps) {
  const isCurrent = currentTier === plan.id;
  const isBestValue = "bestValue" in plan && plan.bestValue;
  const isCurrentPaid = currentTier !== "free";
  const isDowngradeToFree = plan.id === "free" && isCurrentPaid;

  const TIER_ORDER: Record<string, number> = {
    free: 0,
    starter: 1,
    pro: 2,
    ultimate: 3,
  };
  const isUpgrade =
    !isCurrent &&
    plan.id !== "free" &&
    (TIER_ORDER[plan.id] ?? 0) > (TIER_ORDER[currentTier] ?? 0);

  const shopifyPlan = isAnnual
    ? plan.shopifyPlanAnnual
    : plan.shopifyPlanMonthly;

  const displayPrice = isAnnual ? plan.annualMonthlyPrice : plan.monthlyPrice;

  let buttonContent = "Start 7-day free trial";
  if (isCurrent) {
    buttonContent = "Current plan";
  } else if (isDowngradeToFree) {
    buttonContent = "Downgrade to Free";
  } else if (isUpgrade) {
    buttonContent = `Upgrade to ${plan.name}`;
  } else if (!isCurrent && plan.id !== "free" && isCurrentPaid) {
    buttonContent = `Switch to ${plan.name}`;
  }

  const handleClick = () => {
    if (isCurrent) return;
    if (isDowngradeToFree) {
      onRequestCancel();
    } else if (shopifyPlan) {
      onSubscribe(shopifyPlan);
    }
  };

  const isThisLoading = loadingPlan === (shopifyPlan ?? "cancel");

  return (
    <Card>
      <BlockStack gap="400">

        {/* Plan name + badges */}
        <BlockStack gap="100">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingMd" fontWeight="bold">
              {plan.name}
            </Text>
            <InlineStack gap="150">
              {isBestValue && (
                <Badge tone="info" icon={StarIcon}>
                  Most popular
                </Badge>
              )}
              {isCurrent && <Badge tone="success">Active</Badge>}
            </InlineStack>
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">
            {plan.description}
          </Text>
        </BlockStack>

        <Divider />

        {/* Price */}
        <BlockStack gap="100">
          {plan.monthlyPrice === 0 ? (
            <>
              <Text as="p" variant="headingXl" fontWeight="bold">
                Free
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                forever
              </Text>
            </>
          ) : (
            <>
              <InlineStack gap="100" blockAlign="baseline">
                <Text as="p" variant="headingXl" fontWeight="bold">
                  ${displayPrice}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  / month
                </Text>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {isAnnual
                  ? `billed $${plan.annualPrice} / year`
                  : `or $${plan.annualMonthlyPrice}/mo billed annually`}
              </Text>
            </>
          )}
        </BlockStack>

        {/* CTA button */}
        <Button
          variant={isCurrent ? "secondary" : "primary"}
          tone={isDowngradeToFree ? "critical" : undefined}
          onClick={handleClick}
          disabled={isCurrent}
          loading={isThisLoading}
          fullWidth
        >
          {buttonContent}
        </Button>

        <Divider />

        {/* Features list */}
        <BlockStack gap="300">
          {plan.features.map((f) => (
            <PlanFeature key={f} feature={f} />
          ))}
        </BlockStack>

      </BlockStack>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  const { subscription } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const [isAnnual, setIsAnnual] = useState(
    subscription.billingInterval === "annual",
  );
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);

  const data = fetcher.data;
  const isFetching = fetcher.state !== "idle";

  // Toast for success, Banner for errors (errors must not auto-dismiss)
  useEffect(() => {
    if (!isFetching) setLoadingPlan(null);
    if (data && "message" in data && data.message) {
      shopify.toast.show(data.message as string);
    }
  }, [data, isFetching, shopify]);

  const actionError =
    data && "error" in data && data.error ? (data.error as string) : null;

  const handleSubscribe = useCallback(
    (planName: string) => {
      setLoadingPlan(planName);
      const fd = new FormData();
      fd.set("intent", "subscribe");
      fd.set("plan", planName);
      fetcher.submit(fd, { method: "POST" });
    },
    [fetcher],
  );

  const handleConfirmCancel = useCallback(() => {
    setCancelModalOpen(false);
    setLoadingPlan("cancel");
    const fd = new FormData();
    fd.set("intent", "cancel");
    fetcher.submit(fd, { method: "POST" });
  }, [fetcher]);

  const currentTier = subscription.planTier;
  const currentPlanName =
    PLANS_DATA[currentTier as keyof typeof PLANS_DATA]?.name ?? "Free";

  // Suggest next tier for upgrade banner
  const nextTier =
    currentTier === "free"
      ? "starter"
      : currentTier === "starter"
        ? "pro"
        : null;

  return (
    <Page
      title="Pricing"
      subtitle="Choose the plan that's right for your store"
      backAction={{ onAction: () => navigate("/app") }}
    >
      <Box paddingBlockEnd="1600">
      <Layout>
        {actionError && (
          <Layout.Section>
            <Banner tone="critical" title="Billing error">
              <Text as="p" variant="bodyMd">{actionError}</Text>
            </Banner>
          </Layout.Section>
        )}
        <Layout.Section>
          <BlockStack gap="600">

            {/* Current plan status */}
            {nextTier ? (
              <Banner
                tone="info"
                title={`You're on the ${currentPlanName} plan`}
                action={{
                  content: `Upgrade to ${PLANS_DATA[nextTier].name}`,
                  onAction: () => {
                    const plan = isAnnual
                      ? PLANS_DATA[nextTier].shopifyPlanAnnual
                      : PLANS_DATA[nextTier].shopifyPlanMonthly;
                    if (plan) handleSubscribe(plan);
                  },
                }}
              >
                <Text as="p" variant="bodyMd">
                  {currentTier === "free"
                    ? "You have up to 20 allowed zip codes and basic widget access. Upgrade to unlock more features."
                    : "Upgrade to Pro for unlimited zip codes, blocked areas, full waitlist, and more."}
                </Text>
              </Banner>
            ) : (
              <Banner tone="success" title={`You're on the ${currentPlanName} plan`}>
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="success">Active</Badge>
                  <Text as="p" variant="bodyMd">
                    {currentTier === "ultimate"
                      ? "You have full access to all features including VIP support and API access."
                      : "You have unlimited zip codes, blocked areas, delivery rules, and more."}
                  </Text>
                </InlineStack>
              </Banner>
            )}

            {/* Action feedback banners */}
            {data && "success" in data && data.success && (
              <Banner tone="success">
                {data && "message" in data
                  ? String(data.message)
                  : "Plan updated successfully."}
              </Banner>
            )}

            {/* Billing toggle */}
            <BlockStack gap="200" inlineAlign="center">
              <ButtonGroup variant="segmented">
                <Button
                  pressed={!isAnnual}
                  onClick={() => setIsAnnual(false)}
                >
                  Monthly
                </Button>
                <Button
                  pressed={isAnnual}
                  onClick={() => setIsAnnual(true)}
                >
                  Annual · Save up to 38%
                </Button>
              </ButtonGroup>
              {isAnnual && (
                <Badge tone="success">You save up to 38% per year</Badge>
              )}
            </BlockStack>

            {/* Plan cards — 4 columns */}
            <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
              {(
                Object.values(
                  PLANS_DATA,
                ) as (typeof PLANS_DATA)[keyof typeof PLANS_DATA][]
              ).map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  isAnnual={isAnnual}
                  currentTier={currentTier}
                  onSubscribe={handleSubscribe}
                  onRequestCancel={() => setCancelModalOpen(true)}
                  loadingPlan={loadingPlan}
                />
              ))}
            </InlineGrid>

            {/* Trial footnote */}
            {(currentTier === "free" || currentTier === "starter") && (
              <Text
                as="p"
                variant="bodySm"
                tone="subdued"
                alignment="center"
              >
                All paid plans include a 7-day free trial. No credit card
                charged until the trial ends.
              </Text>
            )}

            {/* Set plan directly (for custom app testing) */}
            <Banner tone="info" title="Set Plan Manually">
              <BlockStack gap="300">
                <Text as="p" variant="bodySm">
                  Select a plan to activate it directly:
                </Text>
                <InlineStack gap="200">
                  {(["free", "starter", "pro", "ultimate"] as const).map((tier) => (
                    <Button
                      key={tier}
                      size="slim"
                      variant={currentTier === tier ? "primary" : "secondary"}
                      disabled={currentTier === tier}
                      onClick={() => {
                        const fd = new FormData();
                        fd.set("intent", "test-set-plan");
                        fd.set("tier", tier);
                        fetcher.submit(fd, { method: "POST" });
                      }}
                    >
                      {tier.charAt(0).toUpperCase() + tier.slice(1)}
                    </Button>
                  ))}
                </InlineStack>
              </BlockStack>
            </Banner>

          </BlockStack>
        </Layout.Section>
      </Layout>
      </Box>

      {/* Downgrade confirmation modal */}
      <Modal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        title="Downgrade to Free plan?"
        primaryAction={{
          content: "Yes, downgrade",
          destructive: true,
          onAction: handleConfirmCancel,
          loading: loadingPlan === "cancel",
        }}
        secondaryActions={[
          {
            content: "Keep current plan",
            onAction: () => setCancelModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" variant="bodyMd">
              Downgrading to Free will immediately remove access to:
            </Text>
            <BlockStack gap="200">
              {[
                "Unlimited zip codes — limited to 20",
                "Blocked zip codes",
                "Delivery rules, zones & ETAs",
                "Bulk CSV import & export",
                "Customer waitlist",
                "Widget customization (colors, position)",
                "Cart & checkout blocking",
              ].map((item) => (
                <InlineStack key={item} gap="200" blockAlign="start" wrap={false}>
                  <Text as="span" variant="bodyMd" tone="subdued">·</Text>
                  <Text as="p" variant="bodyMd">{item}</Text>
                </InlineStack>
              ))}
            </BlockStack>
            <Banner tone="warning">
              <Text as="p" variant="bodyMd">
                Zip codes over the 20-entry limit will remain saved but become
                inactive until you upgrade again.
              </Text>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

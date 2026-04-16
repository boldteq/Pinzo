import { useState, useCallback } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useRevalidator, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { getShopSubscription } from "../billing.server";
import { detectThemeEmbed } from "../utils/theme-detection.server";
import { PLAN_LIMITS, UNLIMITED } from "../plans";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  InlineGrid,
  ProgressBar,
  Box,
  Divider,
  List,
} from "@shopify/polaris";
import { PlusIcon } from "@shopify/polaris-icons";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const [totalZips, allowedZips, blockedZips, deliveryRulesCount, waitlistCount, subscription] = await Promise.all([
    db.zipCode.count({ where: { shop } }),
    db.zipCode.count({ where: { shop, type: "allowed" } }),
    db.zipCode.count({ where: { shop, type: "blocked" } }),
    db.deliveryRule.count({ where: { shop } }),
    db.waitlistEntry.count({ where: { shop } }),
    getShopSubscription(shop),
  ]);

  const stats = {
    total: totalZips,
    allowed: allowedZips,
    blocked: blockedZips,
    deliveryRules: deliveryRulesCount,
    waitlist: waitlistCount,
  };

  const themeInfo = await detectThemeEmbed(shop, admin);

  return {
    stats,
    subscription,
    ...themeInfo,
  };
};

export default function DashboardPage() {
  const {
    stats,
    subscription,
    appEmbedEnabled,
    activeThemeName,
    themeEditorUrl,
    themeEditorAppEmbedsUrl,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { revalidate, state: revalidateState } = useRevalidator();
  const limits = PLAN_LIMITS[subscription.planTier];

  // Dismissible onboarding — persisted in localStorage
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => {
    try {
      return localStorage.getItem("zcc-onboarding-dismissed") === "true";
    } catch {
      return false;
    }
  });
  const handleDismissOnboarding = useCallback(() => {
    setOnboardingDismissed(true);
    try {
      localStorage.setItem("zcc-onboarding-dismissed", "true");
    } catch {
      // localStorage unavailable in some contexts
    }
  }, []);
  const isFreePlan = subscription.planTier === "free";
  const hasZipLimit = limits.maxZipCodes < UNLIMITED;
  const isEmpty = stats.total === 0;

  const usagePercent =
    limits.maxZipCodes < UNLIMITED
      ? Math.min(100, Math.round((stats.total / limits.maxZipCodes) * 100))
      : 0;

  const planLabel = limits.label;

  return (
    <Page
      title="Dashboard"
      subtitle={`${planLabel} Plan`}
      primaryAction={{
        content: "Add Zip Code",
        icon: PlusIcon,
        onAction: () => navigate("/app/zip-codes"),
      }}
    >
      <Box paddingBlockEnd="1600">
        <BlockStack gap="500">

          {/* ─── 1. APP STATUS ─── */}
          {appEmbedEnabled ? (
            <Banner
              tone="success"
              title="Widget is live on your store"
              action={{
                content: "Open Theme Editor",
                url: themeEditorUrl,
                external: true,
              }}
            >
              <Text as="p" variant="bodySm">
                {activeThemeName
                  ? `Running on your ${activeThemeName} theme. `
                  : ""}
                Any changes you make here apply to your storefront instantly.
              </Text>
            </Banner>
          ) : (
            <Banner
              tone="warning"
              title="2 steps to show the widget on your store"
              action={{
                content: "Enable in Theme Editor",
                url: themeEditorAppEmbedsUrl,
                external: true,
              }}
              secondaryAction={{
                content: revalidateState === "loading" ? "Checking..." : "Refresh status",
                onAction: revalidate,
              }}
            >
              <List type="number">
                <List.Item>
                  Open <Text as="span" fontWeight="semibold">Theme Editor &gt; App Embeds</Text> and turn on{" "}
                  <Text as="span" fontWeight="semibold">Pinzo</Text>
                </List.Item>
                <List.Item>
                  Go to your <Text as="span" fontWeight="semibold">Product template</Text>, add the{" "}
                  <Text as="span" fontWeight="semibold">Pinzo</Text> block, and save
                </List.Item>
              </List>
            </Banner>
          )}

          {/* ─── 2. STATS ─── */}
          {!isEmpty && (
            <Card>
              <BlockStack gap="400">
                <InlineGrid columns={{ xs: 2, sm: 3, md: 5 }} gap="400">
                  <BlockStack gap="100">
                    <Text as="p" variant="headingXl" fontWeight="bold">
                      {stats.total}
                      {limits.maxZipCodes < UNLIMITED && (
                        <Text as="span" variant="bodySm" tone="subdued" fontWeight="regular">
                          {" "}/ {limits.maxZipCodes}
                        </Text>
                      )}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Zip codes
                    </Text>
                  </BlockStack>

                  <BlockStack gap="100">
                    <Text as="p" variant="headingXl" fontWeight="bold" tone="success">
                      {stats.allowed}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Serviceable
                    </Text>
                  </BlockStack>

                  <BlockStack gap="100">
                    <Text as="p" variant="headingXl" fontWeight="bold" tone={stats.blocked > 0 ? "critical" : "subdued"}>
                      {stats.blocked}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Blocked
                    </Text>
                  </BlockStack>

                  <BlockStack gap="100">
                    <Text as="p" variant="headingXl" fontWeight="bold" tone={stats.waitlist > 0 ? "caution" : "subdued"}>
                      {stats.waitlist}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Waitlisted
                    </Text>
                  </BlockStack>

                  <BlockStack gap="100">
                    <Text as="p" variant="headingXl" fontWeight="bold">
                      {stats.deliveryRules}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Delivery rules
                    </Text>
                  </BlockStack>
                </InlineGrid>

                {/* Usage bar — shown when plan has a finite zip limit */}
                {hasZipLimit && (
                  <>
                    <Divider />
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Plan usage
                        </Text>
                        <Text as="p" variant="bodySm" fontWeight="semibold" tone={usagePercent >= 80 ? "critical" : "subdued"}>
                          {usagePercent}%
                        </Text>
                      </InlineStack>
                      <ProgressBar
                        progress={usagePercent}
                        tone={usagePercent >= 80 ? "critical" : "highlight"}
                        size="small"
                      />
                    </BlockStack>
                  </>
                )}
              </BlockStack>
            </Card>
          )}

          {/* ─── 3. UPGRADE PROMPT ─── */}
          {hasZipLimit && !isEmpty && usagePercent >= 60 && (
            <Banner
              tone="warning"
              action={{
                content: isFreePlan ? "Upgrade to Starter" : "Upgrade to Pro",
                onAction: () => navigate("/app/pricing"),
              }}
            >
              <Text as="p" variant="bodySm">
                You&apos;re using {stats.total} of {limits.maxZipCodes} zip codes on the {planLabel} plan.
                {isFreePlan
                  ? " Upgrade to Starter for 500 zip codes, delivery rules, and more."
                  : " Upgrade to Pro for unlimited zip codes, blocked zones, and full features."}
              </Text>
            </Banner>
          )}

          {/* ─── 4. SETUP GUIDE BANNER (shown to new users) ─── */}
          {!onboardingDismissed && (
            <Banner
              title="Complete your Pinzo setup"
              tone="info"
              action={{
                content: "Start Setup Guide",
                onAction: () => navigate("/app/onboarding"),
              }}
              secondaryAction={{
                content: "Dismiss",
                onAction: handleDismissOnboarding,
              }}
            >
              <Text as="p" variant="bodySm">
                Get the ZIP code widget live on your store in 4 easy steps — takes about 5 minutes.
              </Text>
            </Banner>
          )}

          {/* ─── 5. NAVIGATION ─── */}
          <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
            {[
              {
                title: "Zip Codes",
                desc: "Add, edit, import, or export your service areas.",
                stat: stats.total > 0 ? `${stats.total} total` : undefined,
                action: "Manage zip codes",
                href: "/app/zip-codes",
              },
              {
                title: "Delivery Rules",
                desc: "Set fees, cutoff times, and schedules by zone.",
                stat: stats.deliveryRules > 0 ? `${stats.deliveryRules} rules` : undefined,
                action: "Manage rules",
                href: "/app/delivery-rules",
              },
              {
                title: "Waitlist",
                desc: "View customers requesting delivery to new areas.",
                stat: stats.waitlist > 0 ? `${stats.waitlist} waiting` : undefined,
                action: "View waitlist",
                href: "/app/waitlist",
              },
              {
                title: "Widget",
                desc: "Customize colors, text, and layout on your store.",
                action: "Customize widget",
                href: "/app/widget",
              },
            ].map((item) => (
              <Card key={item.title}>
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingSm">
                      {item.title}
                    </Text>
                    {item.stat && (
                      <Badge tone="info">{item.stat}</Badge>
                    )}
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {item.desc}
                  </Text>
                  <Button
                    size="slim"
                    onClick={() => navigate(item.href)}
                  >
                    {item.action}
                  </Button>
                </BlockStack>
              </Card>
            ))}
          </InlineGrid>

        </BlockStack>
      </Box>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

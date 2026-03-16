import { useState, useCallback } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useRevalidator, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { getShopSubscription } from "../billing.server";
import { PLAN_LIMITS } from "../plans";
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

  const zipCodes = await db.zipCode.findMany({ where: { shop } });
  const [deliveryRulesCount, waitlistCount, subscription] = await Promise.all([
    db.deliveryRule.count({ where: { shop } }),
    db.waitlistEntry.count({ where: { shop } }),
    getShopSubscription(shop),
  ]);

  const stats = {
    total: zipCodes.length,
    allowed: zipCodes.filter((z) => z.type === "allowed").length,
    blocked: zipCodes.filter((z) => z.type === "blocked").length,
    deliveryRules: deliveryRulesCount,
    waitlist: waitlistCount,
  };

  // Detect whether the App Embed is enabled in the active theme (GraphQL)
  let appEmbedEnabled = false;
  let activeThemeName: string | null = null;
  let themeEditorUrl = `https://${shop}/admin/themes/current/editor`;
  let themeEditorAppEmbedsUrl = `https://${shop}/admin/themes/current/editor?context=apps`;

  try {
    const themeResponse = await admin.graphql(`{
      themes(first: 1, roles: MAIN) {
        nodes {
          id
          name
          files(filenames: ["config/settings_data.json"], first: 1) {
            nodes {
              body {
                ... on OnlineStoreThemeFileBodyText {
                  content
                }
              }
            }
          }
        }
      }
    }`);
    const themeData = (await themeResponse.json()) as {
      data?: {
        themes?: {
          nodes?: Array<{
            id: string;
            name: string;
            files?: {
              nodes?: Array<{
                body?: { content?: string };
              }>;
            };
          }>;
        };
      };
    };
    const mainTheme = themeData?.data?.themes?.nodes?.[0];
    if (mainTheme) {
      // Extract numeric ID from GID (e.g. "gid://shopify/OnlineStoreTheme/123")
      const gidParts = mainTheme.id.split("/");
      const numericId = gidParts[gidParts.length - 1];
      activeThemeName = mainTheme.name;
      themeEditorUrl = `https://${shop}/admin/themes/${numericId}/editor`;
      themeEditorAppEmbedsUrl = `https://${shop}/admin/themes/${numericId}/editor?context=apps`;

      const content = mainTheme.files?.nodes?.[0]?.body?.content;
      if (content) {
        const settingsData = JSON.parse(content) as {
          current?: { blocks?: Record<string, unknown> };
        };
        const blocks = settingsData?.current?.blocks ?? {};
        // Block keys/types in settings_data.json look like:
        // shopify://apps/<handle>/blocks/app_embed/<uuid>
        // Only match our app using the SHOPIFY_API_KEY (client_id)
        const apiKey = process.env.SHOPIFY_API_KEY ?? "";
        appEmbedEnabled = Object.entries(blocks).some(
          ([key, block]) => {
            const b = block as { type?: string; disabled?: boolean };
            const typeStr = b.type ?? "";
            const keyStr = key ?? "";
            const isAppEmbed =
              typeStr.includes("app-embed") ||
              typeStr.includes("app_embed");
            if (!isAppEmbed || b.disabled === true) return false;
            // Match by API key (client_id) or app handle in key/type
            if (apiKey && (keyStr.includes(apiKey) || typeStr.includes(apiKey))) {
              return true;
            }
            // Also match by app handle patterns (e.g. "zip-code-checker", "zip-code-widget")
            if (
              keyStr.includes("zip-code") ||
              typeStr.includes("zip-code") ||
              keyStr.includes("zip_code") ||
              typeStr.includes("zip_code")
            ) {
              return true;
            }
            return false;
          },
        );
      }
    }
  } catch {
    // Non-fatal — embed status defaults to false
  }

  return {
    stats,
    subscription,
    appEmbedEnabled,
    activeThemeName,
    themeEditorUrl,
    themeEditorAppEmbedsUrl,
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
  const hasZipLimit = limits.maxZipCodes !== Infinity;
  const isEmpty = stats.total === 0;

  const usagePercent =
    limits.maxZipCodes !== Infinity
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
                  Open <strong>Theme Editor &gt; App Embeds</strong> and turn on{" "}
                  <strong>Zip Code Checker</strong>
                </List.Item>
                <List.Item>
                  Go to your <strong>Product template</strong>, add the{" "}
                  <strong>Zip Code Checker</strong> block, and save
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
                      {limits.maxZipCodes !== Infinity && (
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

          {/* ─── 4. GETTING STARTED (dismissible onboarding) ─── */}
          {isEmpty && !onboardingDismissed && (
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Get started
                  </Text>
                  <Button variant="plain" onClick={handleDismissOnboarding}>
                    Dismiss
                  </Button>
                </InlineStack>
                <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
                  {[
                    {
                      step: "1",
                      title: "Add zip codes",
                      desc: "Enter the zip codes you deliver to, or import them via CSV.",
                      action: "Add zip codes",
                      href: "/app/zip-codes",
                      primary: true,
                    },
                    {
                      step: "2",
                      title: "Customize the widget",
                      desc: "Set colors, text, and position to match your store.",
                      action: "Customize",
                      href: "/app/widget",
                      primary: false,
                    },
                    {
                      step: "3",
                      title: "Add delivery rules",
                      desc: "Set delivery fees, cutoff times, and schedules per zone.",
                      action: "Add rules",
                      href: "/app/delivery-rules",
                      primary: false,
                    },
                  ].map((item) => (
                    <Box
                      key={item.step}
                      padding="400"
                      background="bg-surface-secondary"
                      borderRadius="300"
                    >
                      <BlockStack gap="200">
                        <InlineStack gap="200" blockAlign="center">
                          <Box
                            background="bg-fill-brand"
                            borderRadius="full"
                            padding="100"
                            minWidth="24px"
                            minHeight="24px"
                          >
                            <Text
                              as="span"
                              variant="bodySm"
                              fontWeight="bold"
                              alignment="center"
                              tone="text-inverse"
                            >
                              {item.step}
                            </Text>
                          </Box>
                          <Text as="h3" variant="headingSm">
                            {item.title}
                          </Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {item.desc}
                        </Text>
                        <Button
                          variant={item.primary ? "primary" : undefined}
                          size="slim"
                          onClick={() => navigate(item.href)}
                        >
                          {item.action}
                        </Button>
                      </BlockStack>
                    </Box>
                  ))}
                </InlineGrid>
              </BlockStack>
            </Card>
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

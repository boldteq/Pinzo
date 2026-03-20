import { useState, useCallback, useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useNavigate, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getShopSubscription } from "../billing.server";
import { PLAN_LIMITS, UNLIMITED } from "../plans";
import db from "../db.server";
import { sendTestEmail } from "../email.server";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Divider,
  Box,
  Select,
  TextField,
  Banner,
} from "@shopify/polaris";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [subscription, zipCount, shopSettings] = await Promise.all([
    getShopSubscription(shop),
    db.zipCode.count({ where: { shop } }),
    db.shopSettings.findUnique({ where: { shop } }),
  ]);

  return {
    subscription,
    zipCount,
    shop,
    defaultBehavior: shopSettings?.defaultBehavior ?? "block",
    notificationEmail: shopSettings?.notificationEmail ?? "",
  };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  try {
    if (intent === "save-behavior") {
      const defaultBehavior = formData.get("defaultBehavior") as string;
      if (defaultBehavior !== "block" && defaultBehavior !== "allow") {
        return { error: "Invalid value for defaultBehavior" };
      }
      await db.shopSettings.upsert({
        where: { shop },
        create: { shop, defaultBehavior },
        update: { defaultBehavior },
      });
      return { success: true, intent };
    }

    if (intent === "save-notification") {
      const notificationEmail =
        (formData.get("notificationEmail") as string | null) ?? "";
      await db.shopSettings.upsert({
        where: { shop },
        create: { shop, notificationEmail: notificationEmail || null },
        update: { notificationEmail: notificationEmail || null },
      });
      return { success: true, intent };
    }

    if (intent === "send-test-email") {
      const testEmail = (formData.get("testEmail") as string | null) ?? "";
      if (!testEmail) return { error: "No email address provided." };
      const sent = await sendTestEmail(testEmail);
      return sent
        ? { success: true, intent }
        : { error: "Failed to send test email. Check your Resend API key and sender email." };
    }

    return { error: "Unknown intent" };
  } catch {
    return { error: "Failed to save settings. Please try again." };
  }
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const { subscription, zipCount, shop, defaultBehavior, notificationEmail } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const limits = PLAN_LIMITS[subscription.planTier];

  // Fetchers — one per save section so loading states stay independent
  const behaviorFetcher = useFetcher<typeof action>();
  const notificationFetcher = useFetcher<typeof action>();
  const testEmailFetcher = useFetcher<typeof action>();

  // Local controlled state
  const [behaviorValue, setBehaviorValue] = useState(defaultBehavior);
  const [emailValue, setEmailValue] = useState(notificationEmail);

  const isSavingBehavior = behaviorFetcher.state !== "idle";
  const isSavingNotification = notificationFetcher.state !== "idle";
  const isSaving = isSavingBehavior || isSavingNotification;

  // Track dirty state
  const isDirty =
    behaviorValue !== defaultBehavior || emailValue !== notificationEmail;

  // Toast on success
  useEffect(() => {
    if (
      behaviorFetcher.data &&
      "success" in behaviorFetcher.data &&
      behaviorFetcher.data.success
    ) {
      shopify.toast.show("Settings saved");
    }
  }, [behaviorFetcher.data, shopify]);

  useEffect(() => {
    if (
      notificationFetcher.data &&
      "success" in notificationFetcher.data &&
      notificationFetcher.data.success
    ) {
      shopify.toast.show("Settings saved");
    }
  }, [notificationFetcher.data, shopify]);

  useEffect(() => {
    if (
      testEmailFetcher.data &&
      "success" in testEmailFetcher.data &&
      testEmailFetcher.data.success
    ) {
      shopify.toast.show("Test email sent!");
    }
  }, [testEmailFetcher.data, shopify]);

  const handleBehaviorChange = useCallback(
    (value: string) => setBehaviorValue(value),
    [],
  );

  const handleEmailChange = useCallback(
    (value: string) => setEmailValue(value),
    [],
  );

  const handleSaveAll = useCallback(() => {
    if (behaviorValue !== defaultBehavior) {
      const fd = new FormData();
      fd.append("intent", "save-behavior");
      fd.append("defaultBehavior", behaviorValue);
      behaviorFetcher.submit(fd, { method: "post" });
    }
    if (emailValue !== notificationEmail) {
      const fd = new FormData();
      fd.append("intent", "save-notification");
      fd.append("notificationEmail", emailValue);
      notificationFetcher.submit(fd, { method: "post" });
    }
  }, [behaviorFetcher, notificationFetcher, behaviorValue, emailValue, defaultBehavior, notificationEmail]);

  const handleDiscard = useCallback(() => {
    setBehaviorValue(defaultBehavior);
    setEmailValue(notificationEmail);
  }, [defaultBehavior, notificationEmail]);

  const handleSendTestEmail = useCallback(() => {
    if (!emailValue) return;
    const fd = new FormData();
    fd.append("intent", "send-test-email");
    fd.append("testEmail", emailValue);
    testEmailFetcher.submit(fd, { method: "post" });
  }, [emailValue, testEmailFetcher]);

  const behaviorOptions = [
    {
      label: "Block — show 'not available' message (recommended)",
      value: "block",
    },
    {
      label: "Allow — treat as available (for stores with broad coverage)",
      value: "allow",
    },
  ];

  const planBadgeTone =
    subscription.planTier === "ultimate"
      ? ("success" as const)
      : subscription.planTier === "pro"
        ? ("info" as const)
        : subscription.planTier === "starter"
          ? ("attention" as const)
          : ("new" as const);

  const planLabel = limits.label;

  return (
    <Page
      title="Settings"
      subtitle="Manage your app settings and subscription"
      backAction={{ onAction: () => navigate("/app") }}
      primaryAction={isDirty ? {
        content: "Save",
        onAction: handleSaveAll,
        loading: isSaving,
      } : undefined}
      secondaryActions={isDirty ? [{
        content: "Discard",
        onAction: handleDiscard,
      }] : []}
    >
      <Box paddingBlockEnd="1600">
        <Layout>

          {/* ----------------------------------------------------------------
              Section 1: Subscription
          ---------------------------------------------------------------- */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Subscription
                </Text>
                <Divider />
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd">
                      Current Plan
                    </Text>
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone={planBadgeTone}>{`${planLabel} Plan`}</Badge>
                      {subscription.planTier !== "free" && (
                        <Text as="span" tone="subdued" variant="bodySm">
                          {subscription.billingInterval === "annual"
                            ? "Billed annually"
                            : "Billed monthly"}
                        </Text>
                      )}
                      {(subscription.planTier === "free" || subscription.planTier === "starter") && (
                        <Text as="span" tone="subdued" variant="bodySm">
                          {subscription.planTier === "free" ? "Limited features" : "Essential features"}
                        </Text>
                      )}
                    </InlineStack>
                  </BlockStack>
                  <Button
                    variant="primary"
                    onClick={() => navigate("/app/pricing")}
                  >
                    {subscription.planTier === "free" || subscription.planTier === "starter"
                      ? "Upgrade Plan"
                      : "Manage Plan"}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ----------------------------------------------------------------
              Section 2: Default Behavior for Unknown Zip Codes (NEW)
          ---------------------------------------------------------------- */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Default Behavior for Unknown Zip Codes
                  </Text>
                  <Text as="p" tone="subdued" variant="bodyMd">
                    Choose what happens when a customer enters a zip code that
                    is not in your list.
                  </Text>
                </BlockStack>
                <Divider />
                {behaviorFetcher.data &&
                  "error" in behaviorFetcher.data &&
                  behaviorFetcher.data.error && (
                    <Banner tone="critical">
                      {behaviorFetcher.data.error}
                    </Banner>
                  )}
                <Select
                  label="Behavior for unlisted zip codes"
                  options={behaviorOptions}
                  value={behaviorValue}
                  onChange={handleBehaviorChange}
                />
                <Text as="p" tone="subdued" variant="bodySm">
                  This only applies to zip codes not in your list. Explicitly
                  blocked zip codes are always blocked.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ----------------------------------------------------------------
              Section 3: Notifications (NEW)
          ---------------------------------------------------------------- */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Waitlist Notifications
                  </Text>
                  <Text as="p" tone="subdued" variant="bodyMd">
                    Get notified by email when customers join the waitlist.
                  </Text>
                </BlockStack>
                <Divider />
                {notificationFetcher.data &&
                  "error" in notificationFetcher.data &&
                  notificationFetcher.data.error && (
                    <Banner tone="critical">
                      {notificationFetcher.data.error}
                    </Banner>
                  )}
                {testEmailFetcher.data &&
                  "error" in testEmailFetcher.data &&
                  testEmailFetcher.data.error && (
                    <Banner tone="critical">
                      {testEmailFetcher.data.error}
                    </Banner>
                  )}
                <TextField
                  label="Notification email"
                  type="email"
                  placeholder="your@email.com"
                  value={emailValue}
                  onChange={handleEmailChange}
                  autoComplete="email"
                />
                <Text as="p" tone="subdued" variant="bodySm">
                  If left empty, no email notifications are sent.
                </Text>
                <Button
                  onClick={handleSendTestEmail}
                  loading={testEmailFetcher.state !== "idle"}
                  disabled={!emailValue}
                >
                  Send Test Email
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ----------------------------------------------------------------
              Section 4: Usage & Limits
          ---------------------------------------------------------------- */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Usage &amp; Limits
                </Text>
                <Divider />
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">
                    Zip Codes Used
                  </Text>
                  <Text as="p" fontWeight="semibold">
                    {zipCount}
                    {limits.maxZipCodes < UNLIMITED
                      ? ` / ${limits.maxZipCodes}`
                      : " (Unlimited)"}
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">
                    Blocked Zip Codes
                  </Text>
                  <Text as="p" fontWeight="semibold">
                    {limits.allowBlocked ? "Enabled" : "Not Available"}
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">
                    Delivery Rules
                  </Text>
                  <Text as="p" fontWeight="semibold">
                    {limits.maxDeliveryRules >= UNLIMITED
                      ? "Unlimited"
                      : limits.maxDeliveryRules === 0
                        ? "Not Available"
                        : `Up to ${limits.maxDeliveryRules}`}
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">
                    Waitlist
                  </Text>
                  <Text as="p" fontWeight="semibold">
                    {limits.maxWaitlist >= UNLIMITED
                      ? "Unlimited"
                      : limits.maxWaitlist === 0
                        ? "Not Available"
                        : `Up to ${limits.maxWaitlist} entries`}
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">
                    Store
                  </Text>
                  <Text as="p" fontWeight="semibold">
                    {shop}
                  </Text>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ----------------------------------------------------------------
              Section 5: Data Management (NEW)
          ---------------------------------------------------------------- */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Data Management
                </Text>
                <Divider />
                <InlineStack gap="300" wrap>
                  <Button onClick={() => navigate("/app/zip-codes")}>
                    Manage Zip Codes
                  </Button>
                  <Button onClick={() => navigate("/app/waitlist")}>
                    View Waitlist
                  </Button>
                  <Button onClick={() => navigate("/app/delivery-rules")}>
                    Manage Delivery Rules
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

        </Layout>
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

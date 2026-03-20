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
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const [subscription, zipCount, shopSettings, shopResponse] = await Promise.all([
    getShopSubscription(shop),
    db.zipCode.count({ where: { shop } }),
    db.shopSettings.findUnique({ where: { shop } }),
    admin.graphql(`{ shop { name } }`),
  ]);

  const shopData = await shopResponse.json();
  const shopName: string = shopData.data?.shop?.name ?? shop.replace(".myshopify.com", "");

  // Cache the shop display name so email service can use it without API calls
  await db.shopSettings.upsert({
    where: { shop },
    create: { shop, shopName },
    update: { shopName },
  });

  return {
    subscription,
    zipCount,
    shop,
    shopName,
    defaultBehavior: shopSettings?.defaultBehavior ?? "block",
    notificationEmail: shopSettings?.notificationEmail ?? "",
    emailSenderName: shopSettings?.emailSenderName ?? "",
    emailReplyTo: shopSettings?.emailReplyTo ?? "",
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

    if (intent === "save-email-settings") {
      const emailSenderName =
        (formData.get("emailSenderName") as string | null)?.trim() || null;
      const emailReplyTo =
        (formData.get("emailReplyTo") as string | null)?.trim() || null;
      await db.shopSettings.upsert({
        where: { shop },
        create: { shop, emailSenderName, emailReplyTo },
        update: { emailSenderName, emailReplyTo },
      });
      return { success: true, intent };
    }

    if (intent === "send-test-email") {
      const testEmail = (formData.get("testEmail") as string | null) ?? "";
      if (!testEmail) return { error: "No email address provided." };
      const settings = await db.shopSettings.findUnique({ where: { shop } });
      const sent = await sendTestEmail(
        testEmail,
        { senderName: settings?.emailSenderName, shopDisplayName: settings?.shopName, replyTo: settings?.emailReplyTo },
        shop,
      );
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
  const { subscription, zipCount, shop, shopName, defaultBehavior, notificationEmail, emailSenderName, emailReplyTo } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const limits = PLAN_LIMITS[subscription.planTier];

  // Fetchers — one per save section so loading states stay independent
  const behaviorFetcher = useFetcher<typeof action>();
  const notificationFetcher = useFetcher<typeof action>();
  const emailSettingsFetcher = useFetcher<typeof action>();
  const testEmailFetcher = useFetcher<typeof action>();

  // Local controlled state
  const [behaviorValue, setBehaviorValue] = useState(defaultBehavior);
  const [emailValue, setEmailValue] = useState(notificationEmail);
  const [senderNameValue, setSenderNameValue] = useState(emailSenderName);
  const [replyToValue, setReplyToValue] = useState(emailReplyTo);

  const isSavingBehavior = behaviorFetcher.state !== "idle";
  const isSavingNotification = notificationFetcher.state !== "idle";
  const isSavingEmailSettings = emailSettingsFetcher.state !== "idle";
  const isSaving = isSavingBehavior || isSavingNotification || isSavingEmailSettings;

  // Track dirty state
  const isDirty =
    behaviorValue !== defaultBehavior ||
    emailValue !== notificationEmail ||
    senderNameValue !== emailSenderName ||
    replyToValue !== emailReplyTo;

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
      emailSettingsFetcher.data &&
      "success" in emailSettingsFetcher.data &&
      emailSettingsFetcher.data.success
    ) {
      shopify.toast.show("Email settings saved");
    }
  }, [emailSettingsFetcher.data, shopify]);

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
    if (senderNameValue !== emailSenderName || replyToValue !== emailReplyTo) {
      const fd = new FormData();
      fd.append("intent", "save-email-settings");
      fd.append("emailSenderName", senderNameValue);
      fd.append("emailReplyTo", replyToValue);
      emailSettingsFetcher.submit(fd, { method: "post" });
    }
  }, [behaviorFetcher, notificationFetcher, emailSettingsFetcher, behaviorValue, emailValue, senderNameValue, replyToValue, defaultBehavior, notificationEmail, emailSenderName, emailReplyTo]);

  const handleDiscard = useCallback(() => {
    setBehaviorValue(defaultBehavior);
    setEmailValue(notificationEmail);
    setSenderNameValue(emailSenderName);
    setReplyToValue(emailReplyTo);
  }, [defaultBehavior, notificationEmail, emailSenderName, emailReplyTo]);

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
              Section 3 & 4: Email Settings + Live Preview (side-by-side)
          ---------------------------------------------------------------- */}
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Email Settings
                  </Text>
                  <Text as="p" tone="subdued" variant="bodyMd">
                    Control how notification and customer emails are sent from your store.
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
                {emailSettingsFetcher.data &&
                  "error" in emailSettingsFetcher.data &&
                  emailSettingsFetcher.data.error && (
                    <Banner tone="critical">
                      {emailSettingsFetcher.data.error}
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
                  label="Where should we notify you?"
                  type="email"
                  placeholder="your@email.com"
                  value={emailValue}
                  onChange={handleEmailChange}
                  autoComplete="email"
                  helpText="You'll receive an email here whenever a customer joins the waitlist. Leave blank to disable notifications."
                />
                <TextField
                  label="Sender name"
                  value={senderNameValue}
                  onChange={setSenderNameValue}
                  placeholder={shopName}
                  autoComplete="off"
                  helpText={`This is the name customers see in their inbox. Leave blank to use your store name ("${shopName}").`}
                />
                <TextField
                  label="Reply-to email"
                  type="email"
                  value={replyToValue}
                  onChange={setReplyToValue}
                  placeholder="support@yourstore.com"
                  autoComplete="email"
                  helpText="When a customer hits Reply on your email, their message goes here. Leave blank if you don't need replies."
                />
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

          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Email Preview
                  </Text>
                  <Text as="p" tone="subdued" variant="bodyMd">
                    This is how your emails will appear to customers.
                  </Text>
                </BlockStack>
                <Divider />
                {/* Email client mockup */}
                <Box
                  background="bg-surface-secondary"
                  borderRadius="300"
                  padding="0"
                  borderWidth="025"
                  borderColor="border"
                >
                  {/* Email client header bar */}
                  <Box
                    background="bg-surface"
                    borderRadius="300"
                    padding="400"
                  >
                    <BlockStack gap="300">
                      {/* Header row */}
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="p" variant="headingSm">
                          Inbox
                        </Text>
                        <Box
                          background="bg-surface-secondary"
                          borderRadius="100"
                          padding="100"
                        >
                          <Text as="p" variant="bodySm" tone="subdued">
                            1 new
                          </Text>
                        </Box>
                      </InlineStack>
                      <Divider />
                      {/* Email row in inbox */}
                      <Box
                        background="bg-surface-active"
                        borderRadius="200"
                        padding="300"
                      >
                        <BlockStack gap="100">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="p" variant="bodySm" fontWeight="bold">
                              {senderNameValue.trim() || shopName} via Pinzo
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              just now
                            </Text>
                          </InlineStack>
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            You&apos;re on the waitlist!
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Thanks for signing up — we&apos;ll let you know as soon as delivery becomes available in your area...
                          </Text>
                        </BlockStack>
                      </Box>
                    </BlockStack>
                  </Box>
                  {/* Email detail pane */}
                  <Box padding="400">
                    <BlockStack gap="300">
                      <Text as="p" variant="headingSm" fontWeight="bold">
                        You&apos;re on the waitlist!
                      </Text>
                      <BlockStack gap="150">
                        <InlineStack gap="200" blockAlign="center">
                          <Box minWidth="60px">
                            <Text as="p" variant="bodySm" tone="subdued">
                              From:
                            </Text>
                          </Box>
                          <Text as="p" variant="bodySm">
                            {senderNameValue.trim() || shopName} via Pinzo &lt;noreply@boldteq.app&gt;
                          </Text>
                        </InlineStack>
                        {replyToValue.trim() && (
                          <InlineStack gap="200" blockAlign="center">
                            <Box minWidth="60px">
                              <Text as="p" variant="bodySm" tone="subdued">
                                Reply-To:
                              </Text>
                            </Box>
                            <Text as="p" variant="bodySm">
                              {replyToValue.trim()}
                            </Text>
                          </InlineStack>
                        )}
                        <InlineStack gap="200" blockAlign="center">
                          <Box minWidth="60px">
                            <Text as="p" variant="bodySm" tone="subdued">
                              To:
                            </Text>
                          </Box>
                          <Text as="p" variant="bodySm">
                            customer@example.com
                          </Text>
                        </InlineStack>
                        <InlineStack gap="200" blockAlign="center">
                          <Box minWidth="60px">
                            <Text as="p" variant="bodySm" tone="subdued">
                              Subject:
                            </Text>
                          </Box>
                          <Text as="p" variant="bodySm">
                            You&apos;re on the waitlist!
                          </Text>
                        </InlineStack>
                      </BlockStack>
                      <Divider />
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm">
                          Hi there,
                        </Text>
                        <Text as="p" variant="bodySm">
                          Thanks for your interest! We&apos;ve added you to the waitlist for your area. We&apos;ll send you an email as soon as delivery becomes available near you.
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          — {senderNameValue.trim() || shopName}
                        </Text>
                      </BlockStack>
                      {!replyToValue.trim() && (
                        <Box
                          background="bg-surface-secondary"
                          borderRadius="100"
                          padding="200"
                        >
                          <Text as="p" variant="bodySm" tone="subdued">
                            No reply-to set — customers cannot reply to this email.
                          </Text>
                        </Box>
                      )}
                    </BlockStack>
                  </Box>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ----------------------------------------------------------------
              Section 5: Usage & Limits
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

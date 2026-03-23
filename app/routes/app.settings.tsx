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
  const { subscription, zipCount, shopName, defaultBehavior, notificationEmail, emailSenderName, emailReplyTo } =
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
              Section 1: Plan & Usage (merged)
          ---------------------------------------------------------------- */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="300" blockAlign="center">
                    <div style={{
                      width: 40, height: 40, borderRadius: 10,
                      background: subscription.planTier === "ultimate"
                        ? "linear-gradient(135deg, #15803d, #22c55e)"
                        : subscription.planTier === "pro"
                          ? "linear-gradient(135deg, #1d4ed8, #3b82f6)"
                          : subscription.planTier === "starter"
                            ? "linear-gradient(135deg, #b45309, #f59e0b)"
                            : "linear-gradient(135deg, #6b7280, #9ca3af)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#fff", fontWeight: 700, fontSize: 16, fontFamily: "system-ui",
                    }}>
                      {planLabel.charAt(0)}
                    </div>
                    <BlockStack gap="050">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h2" variant="headingMd">
                          {planLabel} Plan
                        </Text>
                        <Badge tone={planBadgeTone}>Active</Badge>
                      </InlineStack>
                      <Text as="p" tone="subdued" variant="bodySm">
                        {subscription.planTier === "free"
                          ? "Limited features"
                          : subscription.planTier === "starter"
                            ? "Essential features"
                            : subscription.billingInterval === "annual"
                              ? "Billed annually"
                              : "Billed monthly"}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                  <Button
                    variant="primary"
                    onClick={() => navigate("/app/pricing")}
                  >
                    {subscription.planTier === "free" || subscription.planTier === "starter"
                      ? "Upgrade"
                      : "Manage"}
                  </Button>
                </InlineStack>
                <Divider />
                {/* Usage grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
                  <div style={{ background: "#f8f8f8", borderRadius: 10, padding: "12px 16px", textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1a", fontFamily: "system-ui" }}>
                      {zipCount}
                    </div>
                    <div style={{ fontSize: 12, color: "#6b6b6b", fontFamily: "system-ui", marginTop: 2 }}>
                      Zip Codes
                    </div>
                    {limits.maxZipCodes < UNLIMITED && (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ background: "#e5e5e5", borderRadius: 4, height: 4, overflow: "hidden" }}>
                          <div style={{
                            background: zipCount / limits.maxZipCodes > 0.8 ? "#ef4444" : "#22c55e",
                            height: 4, borderRadius: 4,
                            width: `${Math.min(100, (zipCount / limits.maxZipCodes) * 100)}%`,
                          }} />
                        </div>
                        <div style={{ fontSize: 10, color: "#8c8c8c", fontFamily: "system-ui", marginTop: 2 }}>
                          of {limits.maxZipCodes}
                        </div>
                      </div>
                    )}
                    {limits.maxZipCodes >= UNLIMITED && (
                      <div style={{ fontSize: 10, color: "#22c55e", fontFamily: "system-ui", marginTop: 4, fontWeight: 600 }}>
                        Unlimited
                      </div>
                    )}
                  </div>
                  <div style={{ background: "#f8f8f8", borderRadius: 10, padding: "12px 16px", textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1a", fontFamily: "system-ui" }}>
                      {limits.maxDeliveryRules >= UNLIMITED
                        ? "\u221E"
                        : limits.maxDeliveryRules === 0
                          ? "\u2014"
                          : limits.maxDeliveryRules}
                    </div>
                    <div style={{ fontSize: 12, color: "#6b6b6b", fontFamily: "system-ui", marginTop: 2 }}>
                      Delivery Rules
                    </div>
                    <div style={{ fontSize: 10, fontFamily: "system-ui", marginTop: 4, fontWeight: 600, color: limits.maxDeliveryRules === 0 ? "#ef4444" : "#22c55e" }}>
                      {limits.maxDeliveryRules >= UNLIMITED
                        ? "Unlimited"
                        : limits.maxDeliveryRules === 0
                          ? "Not Available"
                          : `Up to ${limits.maxDeliveryRules}`}
                    </div>
                  </div>
                  <div style={{ background: "#f8f8f8", borderRadius: 10, padding: "12px 16px", textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1a", fontFamily: "system-ui" }}>
                      {limits.maxWaitlist >= UNLIMITED
                        ? "\u221E"
                        : limits.maxWaitlist === 0
                          ? "\u2014"
                          : limits.maxWaitlist}
                    </div>
                    <div style={{ fontSize: 12, color: "#6b6b6b", fontFamily: "system-ui", marginTop: 2 }}>
                      Waitlist
                    </div>
                    <div style={{ fontSize: 10, fontFamily: "system-ui", marginTop: 4, fontWeight: 600, color: limits.maxWaitlist === 0 ? "#ef4444" : "#22c55e" }}>
                      {limits.maxWaitlist >= UNLIMITED
                        ? "Unlimited"
                        : limits.maxWaitlist === 0
                          ? "Not Available"
                          : `Up to ${limits.maxWaitlist}`}
                    </div>
                  </div>
                  <div style={{ background: "#f8f8f8", borderRadius: 10, padding: "12px 16px", textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1a", fontFamily: "system-ui" }}>
                      {limits.allowBlocked ? "\u2713" : "\u2717"}
                    </div>
                    <div style={{ fontSize: 12, color: "#6b6b6b", fontFamily: "system-ui", marginTop: 2 }}>
                      Block List
                    </div>
                    <div style={{ fontSize: 10, fontFamily: "system-ui", marginTop: 4, fontWeight: 600, color: limits.allowBlocked ? "#22c55e" : "#ef4444" }}>
                      {limits.allowBlocked ? "Enabled" : "Not Available"}
                    </div>
                  </div>
                </div>
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
                    Email Notifications
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Set up how you get notified and how your emails look to customers.
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

                {/* Your notification email */}
                <Box
                  padding="300"
                  background="bg-surface-secondary"
                  borderRadius="200"
                >
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">
                      Your notification email
                    </Text>
                    <TextField
                      label="Email address"
                      labelHidden
                      type="email"
                      placeholder="your@email.com"
                      value={emailValue}
                      onChange={handleEmailChange}
                      autoComplete="email"
                      helpText="Get notified when someone joins the waitlist. Leave empty to turn off."
                    />
                  </BlockStack>
                </Box>

                {/* What customers see */}
                <Box
                  padding="300"
                  background="bg-surface-secondary"
                  borderRadius="200"
                >
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">
                      What customers see
                    </Text>
                    <TextField
                      label="From name"
                      value={senderNameValue}
                      onChange={setSenderNameValue}
                      placeholder={shopName}
                      autoComplete="off"
                      helpText={`Shown as the sender. Defaults to "${shopName}".`}
                    />
                    <TextField
                      label="Reply-to address"
                      type="email"
                      value={replyToValue}
                      onChange={setReplyToValue}
                      placeholder="support@yourstore.com"
                      autoComplete="email"
                      helpText="Where customer replies go. Leave empty to disable replies."
                    />
                  </BlockStack>
                </Box>

                <Divider />
                <InlineStack align="end">
                  <Button
                    onClick={handleSendTestEmail}
                    loading={testEmailFetcher.state !== "idle"}
                    disabled={!emailValue}
                    variant="primary"
                  >
                    Send Test Email
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Live Preview
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    This updates as you type — what your customers will receive.
                  </Text>
                </BlockStack>
                <Divider />

                {/* Realistic email preview */}
                <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #e0e0e0", boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
                  {/* Email client toolbar */}
                  <div style={{
                    background: "linear-gradient(180deg, #f8f8f8, #f0f0f0)",
                    padding: "10px 16px",
                    display: "flex", alignItems: "center", gap: 8,
                    borderBottom: "1px solid #e0e0e0",
                  }}>
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57", boxShadow: "inset 0 -1px 2px rgba(0,0,0,0.1)" }} />
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e", boxShadow: "inset 0 -1px 2px rgba(0,0,0,0.1)" }} />
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840", boxShadow: "inset 0 -1px 2px rgba(0,0,0,0.1)" }} />
                    <span style={{ marginLeft: 12, fontSize: 13, color: "#666", fontFamily: "system-ui", fontWeight: 500 }}>Inbox</span>
                  </div>

                  {/* Email header */}
                  <div style={{ background: "#ffffff", padding: "16px 20px", borderBottom: "1px solid #f0f0f0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: "50%",
                        background: "linear-gradient(135deg, #6366f1, #a855f7)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#fff", fontWeight: 700, fontSize: 18, fontFamily: "system-ui",
                        flexShrink: 0, boxShadow: "0 2px 8px rgba(99,102,241,0.3)",
                      }}>
                        {(senderNameValue.trim() || shopName).charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 600, fontSize: 14, color: "#1a1a1a", fontFamily: "system-ui" }}>
                            {senderNameValue.trim() || shopName} via Pinzo
                          </span>
                          <span style={{
                            fontSize: 11, color: "#fff", fontFamily: "system-ui",
                            background: "#6366f1", borderRadius: 10, padding: "2px 8px", fontWeight: 500,
                          }}>
                            Now
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "#888", fontFamily: "system-ui", marginTop: 2 }}>
                          noreply@boldteq.app
                        </div>
                        <div style={{ fontSize: 12, color: "#555", fontFamily: "system-ui", marginTop: 4 }}>
                          <span style={{ color: "#888" }}>To:</span> customer@example.com
                          {replyToValue.trim() && (
                            <span style={{ marginLeft: 12, color: "#888" }}>
                              Reply-To: <span style={{ color: "#555" }}>{replyToValue.trim()}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Email body */}
                  <div style={{ background: "#f9fafb", padding: "24px 20px" }}>
                    <div style={{
                      maxWidth: 480, margin: "0 auto",
                      fontFamily: "Arial, sans-serif",
                      background: "#ffffff",
                      borderRadius: 12,
                      overflow: "hidden",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                    }}>
                      {/* Colored header bar */}
                      <div style={{
                        background: "linear-gradient(135deg, #6366f1, #a855f7)",
                        padding: "20px 24px",
                      }}>
                        <div style={{ fontSize: 22, fontWeight: 700, color: "#ffffff", margin: 0 }}>
                          You&apos;re on the waitlist!
                        </div>
                      </div>
                      {/* Body content */}
                      <div style={{ padding: "20px 24px" }}>
                        <p style={{ margin: "0 0 16px", fontSize: 14, lineHeight: 1.7, color: "#333" }}>
                          Thanks for signing up. We&apos;ll let you know as soon as
                          delivery is available to <span style={{
                            background: "#f0f0ff", color: "#6366f1", fontWeight: 600,
                            padding: "1px 6px", borderRadius: 4,
                          }}>10001</span>.
                        </p>
                        <div style={{
                          borderTop: "1px solid #f0f0f0",
                          paddingTop: 16, marginTop: 8,
                          fontSize: 13, color: "#888",
                        }}>
                          — {senderNameValue.trim() || shopName}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div style={{
                    background: "linear-gradient(180deg, #f0f0f0, #e8e8e8)",
                    padding: "10px 20px",
                    textAlign: "center",
                    borderTop: "1px solid #e0e0e0",
                  }}>
                    <span style={{ fontSize: 11, color: "#999", fontFamily: "system-ui" }}>
                      Sent via <span style={{ color: "#6366f1", fontWeight: 600 }}>Pinzo</span> &middot; noreply@boldteq.app
                    </span>
                  </div>
                </div>

                {!replyToValue.trim() && (
                  <Banner tone="warning">
                    No reply-to set — customers won&apos;t be able to reply to this email.
                  </Banner>
                )}
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

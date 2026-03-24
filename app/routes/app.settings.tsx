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
  InlineGrid,
  Icon,
  ProgressBar,
} from "@shopify/polaris";
import {
  LocationIcon,
  DeliveryIcon,
  PersonIcon,
  DisabledIcon,
} from "@shopify/polaris-icons";

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
                <InlineGrid columns={4} gap="300">
                  <Box
                    background="bg-surface-secondary"
                    borderRadius="300"
                    padding="400"
                  >
                    <BlockStack gap="200" inlineAlign="center">
                      <Box
                        background="bg-fill-info"
                        borderRadius="full"
                        padding="200"
                      >
                        <Icon source={LocationIcon} tone="base" />
                      </Box>
                      <Text as="p" variant="headingLg" alignment="center" fontWeight="bold">
                        {zipCount}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        Zip Codes
                      </Text>
                      {limits.maxZipCodes < UNLIMITED && (
                        <Box width="100%">
                          <BlockStack gap="100">
                            <ProgressBar
                              progress={Math.min(100, (zipCount / limits.maxZipCodes) * 100)}
                              size="small"
                              tone={zipCount / limits.maxZipCodes > 0.8 ? "critical" : "success"}
                            />
                            <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                              {zipCount} of {limits.maxZipCodes}
                            </Text>
                          </BlockStack>
                        </Box>
                      )}
                      {limits.maxZipCodes >= UNLIMITED && (
                        <Badge tone="success">Unlimited</Badge>
                      )}
                    </BlockStack>
                  </Box>
                  <Box
                    background="bg-surface-secondary"
                    borderRadius="300"
                    padding="400"
                  >
                    <BlockStack gap="200" inlineAlign="center">
                      <Box
                        background="bg-fill-success"
                        borderRadius="full"
                        padding="200"
                      >
                        <Icon source={DeliveryIcon} tone="base" />
                      </Box>
                      <Text as="p" variant="headingLg" alignment="center" fontWeight="bold">
                        {limits.maxDeliveryRules >= UNLIMITED
                          ? "\u221E"
                          : limits.maxDeliveryRules === 0
                            ? "\u2014"
                            : String(limits.maxDeliveryRules)}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        Delivery Rules
                      </Text>
                      <Badge tone={limits.maxDeliveryRules === 0 ? "critical" : "success"}>
                        {limits.maxDeliveryRules >= UNLIMITED
                          ? "Unlimited"
                          : limits.maxDeliveryRules === 0
                            ? "Not Available"
                            : `Up to ${limits.maxDeliveryRules}`}
                      </Badge>
                    </BlockStack>
                  </Box>
                  <Box
                    background="bg-surface-secondary"
                    borderRadius="300"
                    padding="400"
                  >
                    <BlockStack gap="200" inlineAlign="center">
                      <Box
                        background="bg-fill-warning"
                        borderRadius="full"
                        padding="200"
                      >
                        <Icon source={PersonIcon} tone="base" />
                      </Box>
                      <Text as="p" variant="headingLg" alignment="center" fontWeight="bold">
                        {limits.maxWaitlist >= UNLIMITED
                          ? "\u221E"
                          : limits.maxWaitlist === 0
                            ? "\u2014"
                            : String(limits.maxWaitlist)}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        Waitlist
                      </Text>
                      <Badge tone={limits.maxWaitlist === 0 ? "critical" : "success"}>
                        {limits.maxWaitlist >= UNLIMITED
                          ? "Unlimited"
                          : limits.maxWaitlist === 0
                            ? "Not Available"
                            : `Up to ${limits.maxWaitlist}`}
                      </Badge>
                    </BlockStack>
                  </Box>
                  <Box
                    background="bg-surface-secondary"
                    borderRadius="300"
                    padding="400"
                  >
                    <BlockStack gap="200" inlineAlign="center">
                      <Box
                        background={limits.allowBlocked ? "bg-fill-success" : "bg-fill-critical"}
                        borderRadius="full"
                        padding="200"
                      >
                        <Icon source={DisabledIcon} tone="base" />
                      </Box>
                      <Text as="p" variant="headingLg" alignment="center" fontWeight="bold">
                        {limits.allowBlocked ? "\u2713" : "\u2717"}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        Block List
                      </Text>
                      <Badge tone={limits.allowBlocked ? "success" : "critical"}>
                        {limits.allowBlocked ? "Enabled" : "Not Available"}
                      </Badge>
                    </BlockStack>
                  </Box>
                </InlineGrid>
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
                <div style={{
                  borderRadius: 16, overflow: "hidden",
                  boxShadow: "0 8px 32px rgba(99,102,241,0.12), 0 2px 8px rgba(0,0,0,0.06)",
                  border: "1px solid #e5e7eb",
                }}>
                  {/* macOS toolbar */}
                  <div style={{
                    background: "linear-gradient(180deg, #fafafa, #f3f3f3)",
                    padding: "12px 16px",
                    display: "flex", alignItems: "center", gap: 8,
                    borderBottom: "1px solid #e5e5e5",
                  }}>
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e" }} />
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
                    <div style={{
                      flex: 1, textAlign: "center",
                      fontSize: 12, color: "#999", fontFamily: "system-ui", fontWeight: 500,
                    }}>
                      New Message from {senderNameValue.trim() || shopName}
                    </div>
                  </div>

                  {/* Sender info bar */}
                  <div style={{
                    background: "#ffffff", padding: "14px 20px",
                    borderBottom: "1px solid #f0f0f0",
                    display: "flex", alignItems: "center", gap: 14,
                  }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: "50%",
                      background: "linear-gradient(135deg, #6366f1, #ec4899)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#fff", fontWeight: 700, fontSize: 20, fontFamily: "system-ui",
                      flexShrink: 0, boxShadow: "0 4px 12px rgba(99,102,241,0.35)",
                    }}>
                      {(senderNameValue.trim() || shopName).charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, color: "#1a1a1a", fontFamily: "system-ui" }}>
                        {senderNameValue.trim() || shopName}
                        <span style={{
                          marginLeft: 6, fontSize: 10, color: "#6366f1", fontWeight: 600,
                          background: "#eef2ff", borderRadius: 6, padding: "2px 6px",
                          verticalAlign: "middle",
                        }}>via Pinzo</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#888", fontFamily: "system-ui", marginTop: 3 }}>
                        To: customer@example.com
                        {replyToValue.trim() && (
                          <span> &middot; Reply-To: {replyToValue.trim()}</span>
                        )}
                      </div>
                    </div>
                    <div style={{
                      fontSize: 11, color: "#fff", fontFamily: "system-ui",
                      background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                      borderRadius: 12, padding: "3px 10px", fontWeight: 600,
                      boxShadow: "0 2px 6px rgba(99,102,241,0.3)",
                    }}>
                      Just now
                    </div>
                  </div>

                  {/* Subject line */}
                  <div style={{
                    background: "#ffffff", padding: "12px 20px",
                    borderBottom: "1px solid #f5f5f5",
                  }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#1a1a1a", fontFamily: "system-ui" }}>
                      You&apos;re on the waitlist — {senderNameValue.trim() || shopName}
                    </div>
                  </div>

                  {/* Email body */}
                  <div style={{
                    background: "linear-gradient(180deg, #f8f9ff, #f3f0ff)",
                    padding: "28px 20px",
                  }}>
                    <div style={{
                      fontFamily: "Arial, sans-serif",
                      background: "#ffffff",
                      borderRadius: 16,
                      overflow: "hidden",
                      boxShadow: "0 4px 20px rgba(99,102,241,0.1)",
                    }}>
                      {/* Gradient banner */}
                      <div style={{
                        background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%)",
                        padding: "28px 28px 20px",
                        position: "relative",
                      }}>
                        <div style={{
                          fontSize: 13, color: "rgba(255,255,255,0.8)", fontWeight: 500,
                          marginBottom: 6, letterSpacing: "0.5px", textTransform: "uppercase",
                        }}>
                          Waitlist Confirmation
                        </div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: "#ffffff" }}>
                          You&apos;re on the waitlist!
                        </div>
                      </div>

                      {/* Body content */}
                      <div style={{ padding: "24px 28px" }}>
                        <p style={{ margin: "0 0 20px", fontSize: 15, lineHeight: 1.7, color: "#374151" }}>
                          Hi there! Thanks for signing up. We&apos;ll notify you as soon as
                          delivery is available to your area.
                        </p>

                        {/* ZIP code highlight box */}
                        <div style={{
                          background: "linear-gradient(135deg, #eef2ff, #faf5ff)",
                          borderRadius: 12, padding: "16px 20px",
                          border: "1px solid #e0e7ff",
                          display: "flex", alignItems: "center", gap: 12,
                        }}>
                          <div style={{
                            width: 40, height: 40, borderRadius: 10,
                            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: "#fff", fontSize: 18, flexShrink: 0,
                          }}>
                            &#128205;
                          </div>
                          <div>
                            <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 500 }}>
                              Requested ZIP code
                            </div>
                            <div style={{ fontSize: 22, fontWeight: 800, color: "#4f46e5", letterSpacing: "1px" }}>
                              10001
                            </div>
                          </div>
                        </div>

                        {/* Signature */}
                        <div style={{
                          marginTop: 24, paddingTop: 16,
                          borderTop: "1px solid #f3f4f6",
                          display: "flex", alignItems: "center", gap: 10,
                        }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: "50%",
                            background: "linear-gradient(135deg, #6366f1, #ec4899)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: "#fff", fontWeight: 700, fontSize: 13, fontFamily: "system-ui",
                            flexShrink: 0,
                          }}>
                            {(senderNameValue.trim() || shopName).charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
                              {senderNameValue.trim() || shopName}
                            </div>
                            <div style={{ fontSize: 11, color: "#9ca3af" }}>
                              Sent via Pinzo
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div style={{
                    background: "#ffffff",
                    padding: "12px 20px",
                    textAlign: "center",
                    borderTop: "1px solid #f0f0f0",
                  }}>
                    <span style={{ fontSize: 11, color: "#b0b0b0", fontFamily: "system-ui" }}>
                      Powered by <span style={{ color: "#6366f1", fontWeight: 700 }}>Pinzo</span> &middot; noreply@boldteq.app
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

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
import { sendTestEmail, isEmailConfigured } from "../email.server";
import { detectThemeEmbed } from "../utils/theme-detection.server";
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
  Icon,
  ProgressBar,
  Tabs,
  List,
} from "@shopify/polaris";
import {
  LocationIcon,
  DeliveryIcon,
  PersonIcon,
  DisabledIcon,
  CheckCircleIcon,
} from "@shopify/polaris-icons";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const [subscription, zipCount, deliveryRuleCount, waitlistCount, blockedZipCount, shopSettings, shopResponse, themeInfo] = await Promise.all([
    getShopSubscription(shop),
    db.zipCode.count({ where: { shop } }),
    db.deliveryRule.count({ where: { shop } }),
    db.waitlistEntry.count({ where: { shop } }),
    db.zipCode.count({ where: { shop, type: "blocked" } }),
    db.shopSettings.findUnique({ where: { shop } }),
    admin.graphql(`{ shop { name primaryDomain { url } } }`),
    detectThemeEmbed(shop, admin),
  ]);

  const shopData = await shopResponse.json() as { data?: { shop?: { name?: string; primaryDomain?: { url?: string } } } };
  const shopName: string = shopData.data?.shop?.name ?? shop.replace(".myshopify.com", "");
  const storeDomain: string = shopData.data?.shop?.primaryDomain?.url ?? `https://${shop.replace(".myshopify.com", "")}.myshopify.com`;

  await db.shopSettings.upsert({
    where: { shop },
    create: { shop, shopName },
    update: { shopName },
  });

  return {
    subscription,
    zipCount,
    deliveryRuleCount,
    waitlistCount,
    blockedZipCount,
    shop,
    shopName,
    storeDomain,
    defaultBehavior: shopSettings?.defaultBehavior ?? "block",
    notificationEmail: shopSettings?.notificationEmail ?? "",
    emailSenderName: shopSettings?.emailSenderName ?? "",
    emailReplyTo: shopSettings?.emailReplyTo ?? "",
    ...themeInfo,
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
      if (!isEmailConfigured()) {
        return { error: "Email is not configured — RESEND_API_KEY environment variable is missing. Add it to your .env file and redeploy." };
      }
      const settings = await db.shopSettings.findUnique({ where: { shop } });
      const sent = await sendTestEmail(
        testEmail,
        { senderName: settings?.emailSenderName, shopDisplayName: settings?.shopName, replyTo: settings?.emailReplyTo },
        shop,
      );
      return sent
        ? { success: true, intent }
        : { error: "Failed to send test email via Resend. Verify your RESEND_API_KEY is valid and your sender domain is verified in the Resend dashboard." };
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
  const {
    subscription, zipCount, deliveryRuleCount, waitlistCount, blockedZipCount,
    shopName, storeDomain, defaultBehavior, notificationEmail, emailSenderName, emailReplyTo,
    appEmbedEnabled, activeThemeName, themeEditorUrl, themeEditorAppEmbedsUrl,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const limits = PLAN_LIMITS[subscription.planTier];

  const [selectedTab, setSelectedTab] = useState(0);

  // Fetchers
  const behaviorFetcher = useFetcher<typeof action>();
  const notificationFetcher = useFetcher<typeof action>();
  const emailSettingsFetcher = useFetcher<typeof action>();
  const testEmailFetcher = useFetcher<typeof action>();

  // Controlled state
  const [behaviorValue, setBehaviorValue] = useState(defaultBehavior);
  const [emailValue, setEmailValue] = useState(notificationEmail);
  const [senderNameValue, setSenderNameValue] = useState(emailSenderName);
  const [replyToValue, setReplyToValue] = useState(emailReplyTo);

  const isSavingBehavior = behaviorFetcher.state !== "idle";
  const isSavingNotification = notificationFetcher.state !== "idle";
  const isSavingEmailSettings = emailSettingsFetcher.state !== "idle";
  const isSaving = isSavingBehavior || isSavingNotification || isSavingEmailSettings;

  const isGeneralDirty = behaviorValue !== defaultBehavior;
  const isEmailDirty =
    emailValue !== notificationEmail ||
    senderNameValue !== emailSenderName ||
    replyToValue !== emailReplyTo;
  const isDirty = isGeneralDirty || isEmailDirty;

  useEffect(() => {
    if (behaviorFetcher.data && "success" in behaviorFetcher.data && behaviorFetcher.data.success) {
      shopify.toast.show("Settings saved");
    }
  }, [behaviorFetcher.data, shopify]);

  useEffect(() => {
    if (notificationFetcher.data && "success" in notificationFetcher.data && notificationFetcher.data.success) {
      shopify.toast.show("Settings saved");
    }
  }, [notificationFetcher.data, shopify]);

  useEffect(() => {
    if (emailSettingsFetcher.data && "success" in emailSettingsFetcher.data && emailSettingsFetcher.data.success) {
      shopify.toast.show("Email settings saved");
    }
  }, [emailSettingsFetcher.data, shopify]);

  useEffect(() => {
    if (testEmailFetcher.data && "success" in testEmailFetcher.data && testEmailFetcher.data.success) {
      shopify.toast.show("Test email sent!");
    }
  }, [testEmailFetcher.data, shopify]);

  const handleSaveGeneral = useCallback(() => {
    const fd = new FormData();
    fd.append("intent", "save-behavior");
    fd.append("defaultBehavior", behaviorValue);
    behaviorFetcher.submit(fd, { method: "post" });
  }, [behaviorFetcher, behaviorValue]);

  const handleSaveEmail = useCallback(() => {
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
  }, [notificationFetcher, emailSettingsFetcher, emailValue, senderNameValue, replyToValue, notificationEmail, emailSenderName, emailReplyTo]);

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
    { label: "Block — show 'not available' message (recommended)", value: "block" },
    { label: "Allow — treat as available (for stores with broad coverage)", value: "allow" },
  ];

  const planBadgeTone =
    subscription.planTier === "ultimate" ? ("success" as const)
    : subscription.planTier === "pro" ? ("info" as const)
    : subscription.planTier === "starter" ? ("attention" as const)
    : ("new" as const);

  const planLabel = limits.label;

  const tabs = [
    { id: "general", content: "General" },
    { id: "email", content: "Email" },
    { id: "plan", content: "Plan & Usage" },
    { id: "setup", content: "Setup Guide" },
  ];

  // Dynamic save action based on active tab
  const getSaveAction = () => {
    if (selectedTab === 0 && isGeneralDirty) {
      return { content: "Save", onAction: handleSaveGeneral, loading: isSavingBehavior };
    }
    if (selectedTab === 1 && isEmailDirty) {
      return { content: "Save", onAction: handleSaveEmail, loading: isSavingNotification || isSavingEmailSettings };
    }
    return undefined;
  };

  return (
    <Page
      title="Settings"
      subtitle="Manage your app settings and subscription"
      backAction={{ onAction: () => navigate("/app") }}
      primaryAction={getSaveAction()}
      secondaryActions={isDirty && selectedTab < 2 ? [{ content: "Discard", onAction: handleDiscard }] : []}
    >
      <Box paddingBlockEnd="1600">
        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
          {/* ── TAB 0: General ────────────────────────────────────────── */}
          {selectedTab === 0 && (
            <Box paddingBlockStart="500">
              <Layout>
                <Layout.Section>
                  <Card>
                    <BlockStack gap="400">
                      <BlockStack gap="100">
                        <Text as="h2" variant="headingMd">
                          Default Behavior for Unknown ZIP Codes
                        </Text>
                        <Text as="p" tone="subdued" variant="bodyMd">
                          Choose what happens when a customer enters a ZIP code that is not in your list.
                        </Text>
                      </BlockStack>
                      <Divider />
                      {behaviorFetcher.data && "error" in behaviorFetcher.data && behaviorFetcher.data.error && (
                        <Banner tone="critical">{behaviorFetcher.data.error}</Banner>
                      )}
                      <Select
                        label="Behavior for unlisted ZIP codes"
                        options={behaviorOptions}
                        value={behaviorValue}
                        onChange={setBehaviorValue}
                      />
                      <Text as="p" tone="subdued" variant="bodySm">
                        This only applies to ZIP codes not in your list. Explicitly blocked ZIP codes are always blocked.
                      </Text>
                    </BlockStack>
                  </Card>
                </Layout.Section>
              </Layout>
            </Box>
          )}

          {/* ── TAB 1: Email ──────────────────────────────────────────── */}
          {selectedTab === 1 && (
            <Box paddingBlockStart="500">
              <Layout>
                <Layout.Section variant="oneHalf">
                  {limits.maxWaitlist === 0 ? (
                    <Banner
                      tone="info"
                      title="Email notifications require Starter plan or higher"
                      action={{ content: "Upgrade plan", onAction: () => navigate("/app/pricing") }}
                    >
                      Upgrade to Starter or above to receive waitlist notifications and configure customer-facing emails.
                    </Banner>
                  ) : (
                    <Card>
                      <BlockStack gap="400">
                        <BlockStack gap="100">
                          <Text as="h2" variant="headingMd">Email Notifications</Text>
                          <Text as="p" tone="subdued" variant="bodySm">
                            Set up how you get notified and how your emails look to customers.
                          </Text>
                        </BlockStack>
                        <Divider />
                        {notificationFetcher.data && "error" in notificationFetcher.data && notificationFetcher.data.error && (
                          <Banner tone="critical">{notificationFetcher.data.error}</Banner>
                        )}
                        {emailSettingsFetcher.data && "error" in emailSettingsFetcher.data && emailSettingsFetcher.data.error && (
                          <Banner tone="critical">{emailSettingsFetcher.data.error}</Banner>
                        )}
                        {testEmailFetcher.data && "error" in testEmailFetcher.data && testEmailFetcher.data.error && (
                          <Banner tone="critical">{testEmailFetcher.data.error}</Banner>
                        )}

                        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                          <BlockStack gap="200">
                            <Text as="h3" variant="headingSm">Your notification email</Text>
                            <TextField
                              label="Email address"
                              labelHidden
                              type="email"
                              placeholder="your@email.com"
                              value={emailValue}
                              onChange={setEmailValue}
                              autoComplete="email"
                              helpText="Get notified when someone joins the waitlist. Leave empty to turn off."
                            />
                          </BlockStack>
                        </Box>

                        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                          <BlockStack gap="300">
                            <Text as="h3" variant="headingSm">What customers see</Text>
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
                  )}
                </Layout.Section>

                <Layout.Section variant="oneHalf">
                  <Card>
                    <BlockStack gap="400">
                      <BlockStack gap="100">
                        <Text as="h2" variant="headingMd">Live Preview</Text>
                        <Text as="p" tone="subdued" variant="bodySm">
                          This updates as you type — what your customers will receive.
                        </Text>
                      </BlockStack>
                      <Divider />

                      <div style={{
                        borderRadius: 16, overflow: "hidden",
                        boxShadow: "0 8px 32px rgba(99,102,241,0.12), 0 2px 8px rgba(0,0,0,0.06)",
                        border: "1px solid #e5e7eb",
                      }}>
                        <div style={{
                          background: "linear-gradient(180deg, #fafafa, #f3f3f3)",
                          padding: "12px 16px",
                          display: "flex", alignItems: "center", gap: 8,
                          borderBottom: "1px solid #e5e5e5",
                        }}>
                          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
                          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e" }} />
                          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
                          <div style={{ flex: 1, textAlign: "center", fontSize: 12, color: "#999", fontFamily: "system-ui", fontWeight: 500 }}>
                            New Message from {senderNameValue.trim() || shopName}
                          </div>
                        </div>

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
                                background: "#eef2ff", borderRadius: 6, padding: "2px 6px", verticalAlign: "middle",
                              }}>via Pinzo</span>
                            </div>
                            <div style={{ fontSize: 12, color: "#888", fontFamily: "system-ui", marginTop: 3 }}>
                              To: customer@example.com
                              {replyToValue.trim() && <span> · Reply-To: {replyToValue.trim()}</span>}
                            </div>
                          </div>
                        </div>

                        <div style={{ background: "#ffffff", padding: "12px 20px", borderBottom: "1px solid #f5f5f5" }}>
                          <div style={{ fontSize: 16, fontWeight: 700, color: "#1a1a1a", fontFamily: "system-ui" }}>
                            You&apos;re on the waitlist — {senderNameValue.trim() || shopName}
                          </div>
                        </div>

                        <div style={{ background: "linear-gradient(180deg, #f8f9ff, #f3f0ff)", padding: "28px 20px" }}>
                          <div style={{
                            fontFamily: "Arial, sans-serif",
                            background: "#ffffff", borderRadius: 16, overflow: "hidden",
                            boxShadow: "0 4px 20px rgba(99,102,241,0.1)",
                          }}>
                            <div style={{
                              background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%)",
                              padding: "28px 28px 20px",
                            }}>
                              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", fontWeight: 500, marginBottom: 6 }}>
                                Waitlist Confirmation
                              </div>
                              <div style={{ fontSize: 24, fontWeight: 800, color: "#ffffff" }}>
                                You&apos;re on the waitlist!
                              </div>
                            </div>
                            <div style={{ padding: "24px 28px" }}>
                              <p style={{ margin: "0 0 20px", fontSize: 15, lineHeight: 1.7, color: "#374151" }}>
                                Hi there! Thanks for signing up. We&apos;ll notify you as soon as delivery is available to your area.
                              </p>
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
                                }}>📍</div>
                                <div>
                                  <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 500 }}>Requested ZIP code</div>
                                  <div style={{ fontSize: 22, fontWeight: 800, color: "#4f46e5", letterSpacing: "1px" }}>10001</div>
                                </div>
                              </div>
                              <div style={{
                                marginTop: 24, paddingTop: 16,
                                borderTop: "1px solid #f3f4f6",
                                display: "flex", alignItems: "center", gap: 10,
                              }}>
                                <div style={{
                                  width: 32, height: 32, borderRadius: "50%",
                                  background: "linear-gradient(135deg, #6366f1, #ec4899)",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  color: "#fff", fontWeight: 700, fontSize: 13, fontFamily: "system-ui", flexShrink: 0,
                                }}>
                                  {(senderNameValue.trim() || shopName).charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{senderNameValue.trim() || shopName}</div>
                                  <div style={{ fontSize: 11, color: "#9ca3af" }}>Sent via Pinzo</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div style={{ background: "#ffffff", padding: "12px 20px", textAlign: "center", borderTop: "1px solid #f0f0f0" }}>
                          <span style={{ fontSize: 11, color: "#b0b0b0", fontFamily: "system-ui" }}>
                            Powered by <span style={{ color: "#6366f1", fontWeight: 700 }}>Pinzo</span> · noreply@boldteq.app
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
          )}

          {/* ── TAB 2: Plan & Usage ───────────────────────────────────── */}
          {selectedTab === 2 && (
            <Box paddingBlockStart="500">
              <Layout>
                <Layout.Section>
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="050">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="h2" variant="headingMd">{planLabel} Plan</Text>
                            <Badge tone={planBadgeTone}>Active</Badge>
                          </InlineStack>
                          <Text as="p" tone="subdued" variant="bodySm">
                            {subscription.planTier === "free" ? "Limited features"
                              : subscription.planTier === "starter" ? "Essential features"
                              : subscription.billingInterval === "annual" ? "Billed annually" : "Billed monthly"}
                          </Text>
                        </BlockStack>
                        <Button variant="primary" onClick={() => navigate("/app/pricing")}>
                          {subscription.planTier === "free" || subscription.planTier === "starter" ? "Upgrade" : "Manage"}
                        </Button>
                      </InlineStack>
                      <Divider />

                      <BlockStack gap="400">
                        {/* Zip Codes */}
                        <BlockStack gap="200">
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="200" blockAlign="center">
                              <Icon source={LocationIcon} tone="subdued" />
                              <Text as="p" variant="bodySm">ZIP Codes</Text>
                            </InlineStack>
                            {limits.maxZipCodes < UNLIMITED ? (
                              <InlineStack gap="100" blockAlign="baseline">
                                <Text as="p" variant="headingLg" fontWeight="bold">{zipCount}</Text>
                                <Text as="span" tone="subdued" variant="bodySm">/ {limits.maxZipCodes} used</Text>
                              </InlineStack>
                            ) : (
                              <InlineStack gap="200" blockAlign="center">
                                <Text as="p" variant="headingLg" fontWeight="bold">{zipCount}</Text>
                                <Badge tone="success">Unlimited</Badge>
                              </InlineStack>
                            )}
                          </InlineStack>
                          {limits.maxZipCodes < UNLIMITED && (
                            <ProgressBar
                              progress={Math.min(100, (zipCount / limits.maxZipCodes) * 100)}
                              size="small"
                              tone={zipCount / limits.maxZipCodes > 0.8 ? "critical" : "primary"}
                            />
                          )}
                        </BlockStack>

                        <Divider />

                        {/* Delivery Rules */}
                        <BlockStack gap="200">
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="200" blockAlign="center">
                              <Icon source={DeliveryIcon} tone="subdued" />
                              <Text as="p" variant="bodySm">Delivery Rules</Text>
                            </InlineStack>
                            {limits.maxDeliveryRules >= UNLIMITED ? (
                              <InlineStack gap="200" blockAlign="center">
                                <Text as="p" variant="headingLg" fontWeight="bold">{deliveryRuleCount}</Text>
                                <Badge tone="success">Unlimited</Badge>
                              </InlineStack>
                            ) : limits.maxDeliveryRules === 0 ? (
                              <Badge tone="critical">Not Available</Badge>
                            ) : (
                              <InlineStack gap="100" blockAlign="baseline">
                                <Text as="p" variant="headingLg" fontWeight="bold">{deliveryRuleCount}</Text>
                                <Text as="span" tone="subdued" variant="bodySm">/ {limits.maxDeliveryRules} used</Text>
                              </InlineStack>
                            )}
                          </InlineStack>
                          {limits.maxDeliveryRules > 0 && limits.maxDeliveryRules < UNLIMITED && (
                            <ProgressBar
                              progress={Math.min(100, (deliveryRuleCount / limits.maxDeliveryRules) * 100)}
                              size="small"
                              tone={deliveryRuleCount / limits.maxDeliveryRules > 0.8 ? "critical" : "primary"}
                            />
                          )}
                        </BlockStack>

                        <Divider />

                        {/* Waitlist */}
                        <BlockStack gap="200">
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="200" blockAlign="center">
                              <Icon source={PersonIcon} tone="subdued" />
                              <Text as="p" variant="bodySm">Waitlist Entries</Text>
                            </InlineStack>
                            {limits.maxWaitlist >= UNLIMITED ? (
                              <InlineStack gap="200" blockAlign="center">
                                <Text as="p" variant="headingLg" fontWeight="bold">{waitlistCount}</Text>
                                <Badge tone="success">Unlimited</Badge>
                              </InlineStack>
                            ) : limits.maxWaitlist === 0 ? (
                              <Badge tone="critical">Not Available</Badge>
                            ) : (
                              <InlineStack gap="100" blockAlign="baseline">
                                <Text as="p" variant="headingLg" fontWeight="bold">{waitlistCount}</Text>
                                <Text as="span" tone="subdued" variant="bodySm">/ {limits.maxWaitlist} used</Text>
                              </InlineStack>
                            )}
                          </InlineStack>
                          {limits.maxWaitlist > 0 && limits.maxWaitlist < UNLIMITED && (
                            <ProgressBar
                              progress={Math.min(100, (waitlistCount / limits.maxWaitlist) * 100)}
                              size="small"
                              tone={waitlistCount / limits.maxWaitlist > 0.8 ? "critical" : "primary"}
                            />
                          )}
                        </BlockStack>

                        <Divider />

                        {/* Block List */}
                        <InlineStack align="space-between" blockAlign="center">
                          <InlineStack gap="200" blockAlign="center">
                            <Icon source={DisabledIcon} tone="subdued" />
                            <Text as="p" variant="bodySm">Block List</Text>
                          </InlineStack>
                          {limits.allowBlocked ? (
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="p" variant="headingLg" fontWeight="bold">{blockedZipCount}</Text>
                              <Text as="span" tone="subdued" variant="bodySm">blocked</Text>
                              <Badge tone="success">Enabled</Badge>
                            </InlineStack>
                          ) : (
                            <Badge tone="critical">Not Available</Badge>
                          )}
                        </InlineStack>
                      </BlockStack>
                    </BlockStack>
                  </Card>
                </Layout.Section>
              </Layout>
            </Box>
          )}

          {/* ── TAB 3: Setup Guide ────────────────────────────────────── */}
          {selectedTab === 3 && (
            <Box paddingBlockStart="500">
              <Layout>
                <Layout.Section>
                  {/* Step 1: App Embed */}
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack gap="300" blockAlign="center">
                        <div style={{
                          width: 32, height: 32, borderRadius: "50%",
                          background: appEmbedEnabled ? "#008060" : "#6366f1",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#fff", fontWeight: 700, fontSize: 14, flexShrink: 0,
                        }}>
                          {appEmbedEnabled ? <Icon source={CheckCircleIcon} tone="inherit" /> : "1"}
                        </div>
                        <Text as="h2" variant="headingMd">Enable App Embed</Text>
                        {appEmbedEnabled && <Badge tone="success">Complete</Badge>}
                      </InlineStack>
                      <Divider />
                      {appEmbedEnabled ? (
                        <Banner tone="success">
                          <Text as="p">
                            Pinzo App Embed is active on your {activeThemeName ? `"${activeThemeName}" theme` : "store"}.
                          </Text>
                        </Banner>
                      ) : (
                        <Banner
                          tone="warning"
                          action={{ content: "Open App Embeds", url: themeEditorAppEmbedsUrl, external: true }}
                        >
                          <Text as="p">
                            Go to Theme Editor → App Embeds and turn on <strong>Pinzo</strong> to activate the widget.
                          </Text>
                        </Banner>
                      )}
                      <Button url={themeEditorAppEmbedsUrl} external variant={appEmbedEnabled ? "plain" : "primary"}>
                        {appEmbedEnabled ? "View App Embeds" : "Enable in Theme Editor"}
                      </Button>
                    </BlockStack>
                  </Card>
                </Layout.Section>

                <Layout.Section>
                  {/* Step 2: Add Widget Block */}
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack gap="300" blockAlign="center">
                        <div style={{
                          width: 32, height: 32, borderRadius: "50%",
                          background: "#6366f1",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#fff", fontWeight: 700, fontSize: 14, flexShrink: 0,
                        }}>2</div>
                        <Text as="h2" variant="headingMd">Add Widget Block to Product Pages</Text>
                      </InlineStack>
                      <Divider />
                      <Text as="p" tone="subdued">
                        In the Theme Editor, navigate to your <strong>Product template</strong>, click <strong>Add block</strong>, find the <strong>Pinzo</strong> block, and place it where you want the ZIP code checker to appear.
                      </Text>
                      <List>
                        <List.Item>Open Theme Editor for your product template</List.Item>
                        <List.Item>Click "Add block" in the left sidebar</List.Item>
                        <List.Item>Search for "Pinzo" and add it</List.Item>
                        <List.Item>Save the theme</List.Item>
                      </List>
                      <Button url={themeEditorUrl} external>Open Theme Editor</Button>
                    </BlockStack>
                  </Card>
                </Layout.Section>

                <Layout.Section>
                  {/* Step 3: Add ZIP codes */}
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack gap="300" blockAlign="center">
                        <div style={{
                          width: 32, height: 32, borderRadius: "50%",
                          background: "#6366f1",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#fff", fontWeight: 700, fontSize: 14, flexShrink: 0,
                        }}>3</div>
                        <Text as="h2" variant="headingMd">Add Your ZIP Codes</Text>
                      </InlineStack>
                      <Divider />
                      <Text as="p" tone="subdued">
                        Add the ZIP codes you deliver to. You can add them one by one or import via CSV. The widget will show availability based on your list.
                      </Text>
                      <Button url="/app/zip-codes">Go to ZIP Codes</Button>
                    </BlockStack>
                  </Card>
                </Layout.Section>

                <Layout.Section>
                  {/* Step 4: Test */}
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack gap="300" blockAlign="center">
                        <div style={{
                          width: 32, height: 32, borderRadius: "50%",
                          background: "#6366f1",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#fff", fontWeight: 700, fontSize: 14, flexShrink: 0,
                        }}>4</div>
                        <Text as="h2" variant="headingMd">Test on Your Storefront</Text>
                      </InlineStack>
                      <Divider />
                      <Text as="p" tone="subdued">
                        Visit your store and navigate to a product page. Enter a ZIP code you added to test the widget is working correctly.
                      </Text>
                      <Button url={storeDomain} external>Open Storefront</Button>
                    </BlockStack>
                  </Card>
                </Layout.Section>
              </Layout>
            </Box>
          )}
        </Tabs>
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

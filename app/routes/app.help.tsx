import { useState, useCallback } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useNavigate, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Divider,
  Box,
  Collapsible,
  Icon,
  InlineGrid,
  Badge,
} from "@shopify/polaris";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ChatIcon,
  EmailNewsletterIcon,
  LightbulbIcon,
  CalendarTimeIcon,
  SmileyHappyIcon,
} from "@shopify/polaris-icons";

// ---------------------------------------------------------------------------
// Loader — auth only, no data needed
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {};
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function HelpPage() {
  const navigate = useNavigate();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const handleFaqToggle = useCallback((index: number) => {
    setOpenFaq((prev) => (prev === index ? null : index));
  }, []);

  const faqs: Array<{ question: string; answer: string }> = [
    // ── Setup & Installation ──
    {
      question: "How do I add the widget to my store?",
      answer:
        "Go to Online Store → Themes → Customize. First, enable 'Pinzo' under App Embeds (this loads the widget script). Then go to your Product page template, click 'Add block' under the Apps section, and select the Pinzo block. Save your theme — the widget will appear on your storefront immediately.",
    },
    {
      question: "The widget isn't showing on my store. What should I check?",
      answer:
        "Check three things: (1) Make sure the Pinzo App Embed is enabled in Theme Editor → App Embeds. (2) Make sure you've added the Pinzo block to your product page template. (3) Make sure you have at least one ZIP code added in the Zip Codes page. If the Dashboard still shows 'Widget not active', click 'Refresh status' — the detection can take a moment after saving your theme.",
    },
    // ── ZIP Codes ──
    {
      question: "How many ZIP codes can I add?",
      answer:
        "Free plan: 20 allowed ZIP codes. Starter: 500 (allowed + blocked). Pro and Ultimate: Unlimited. You can check your current usage on the Dashboard or Settings page.",
    },
    {
      question: "What's the difference between allowed and blocked ZIP codes?",
      answer:
        "Allowed ZIP codes show a success message ('We deliver to your area!'). Blocked ZIP codes show an explicit denial message. Blocking is useful when you want to explicitly tell customers in certain areas that you don't deliver there, rather than showing a generic 'not found' message. Blocked ZIP codes require the Starter plan or higher.",
    },
    {
      question: "Can I import ZIP codes in bulk?",
      answer:
        "Yes — go to Zip Codes and click 'Import CSV'. Your CSV file should have columns for zip code, and optionally: label, zone, message, ETA, type (allowed/blocked), COD availability, and return policy. You can also use 'Add Range' to add a sequential range of ZIP codes at once. CSV import requires the Starter plan or higher.",
    },
    {
      question: "Can I export my ZIP codes?",
      answer:
        "Yes — go to Zip Codes and click 'Export CSV'. This downloads all your ZIP codes with their settings (zone, message, ETA, COD, return policy, type, active status). CSV export requires the Pro plan or higher.",
    },
    {
      question: "What happens when a customer enters a ZIP code that isn't in my list?",
      answer:
        "This depends on your Default Behavior setting (found in Settings). 'Block' mode (default) shows an error message for unlisted ZIP codes. 'Allow' mode shows a success message for unlisted ZIP codes — useful if you deliver almost everywhere and only want to block specific areas.",
    },
    // ── Delivery Rules ──
    {
      question: "What are delivery rules?",
      answer:
        "Delivery rules let you set conditions per zone or ZIP code — including delivery fees, minimum order amounts, free shipping thresholds, estimated delivery times, order cutoff times, and delivery days of the week. Rules are matched by priority (lower number = higher priority). Delivery rules require the Starter plan or higher.",
    },
    {
      question: "How are delivery rules matched to a ZIP code?",
      answer:
        "When a customer checks a ZIP code, Pinzo first looks for a rule with that specific ZIP code listed. If none is found, it looks for a rule matching the ZIP code's zone. If multiple rules match, the one with the highest priority (lowest number) wins. If no rule matches, the ZIP code's own ETA and message are used.",
    },
    // ── Waitlist ──
    {
      question: "How does the waitlist work?",
      answer:
        "When delivery isn't available for a ZIP code and you have the waitlist enabled in Widget Settings, customers can enter their email to be notified when you expand to their area. You manage the waitlist from the Waitlist page — you can accept requests (which adds the ZIP to your allowed list), notify customers by email, and track conversion status.",
    },
    {
      question: "Do customers receive an email when they join the waitlist?",
      answer:
        "Yes — both the customer and you (the merchant) receive emails automatically. The customer gets a confirmation that they've been added. You get an alert with their email, ZIP code, and name. Make sure your notification email is set in Settings. Emails are sent via your configured sender name and reply-to address.",
    },
    // ── Widget Customization ──
    {
      question: "Can I customize the widget appearance?",
      answer:
        "Yes — go to Widget Customization to change colors (primary, success, error, background, text), text (heading, placeholder, button, messages), position (inline, floating, popup), border radius, and feature toggles (ETA, COD, return policy, delivery date, countdown, delivery fee, waitlist, social proof). Full customization requires the Starter plan or higher.",
    },
    {
      question: "What are the widget position options?",
      answer:
        "Inline: The widget appears directly within the page content where you placed the block. Floating: A small trigger button appears in the corner that opens a panel. Popup: A button that opens the widget in a modal overlay. Inline is the most common choice for product pages.",
    },
    {
      question: "Can I add custom CSS to the widget?",
      answer:
        "Yes — the Ultimate plan includes a Custom CSS editor in Widget Customization. You can target classes like .zcc-heading, .zcc-btn, .zcc-input, .zcc-result, .zcc-search-bar, .zcc-meta, and many more. The class reference is shown below the CSS editor.",
    },
    // ── Cart Blocking ──
    {
      question: "How does cart/checkout blocking work?",
      answer:
        "With the Pro plan or higher, you can enable 'Block checkout for unserviceable ZIP codes' in Widget Settings. Then add the 'Pinzo — Cart Validator' block to your cart page template in the Theme Editor. Customers must enter a valid, serviceable ZIP code before they can proceed to checkout. The Add to Cart and Checkout buttons are disabled until a valid ZIP is checked.",
    },
    // ── Billing & Plans ──
    {
      question: "How does billing work?",
      answer:
        "Pinzo uses Shopify's built-in billing system — charges appear on your regular Shopify invoice. All paid plans include a 7-day free trial. You can switch plans or cancel anytime from the Pricing page. When you cancel, you're moved to the Free plan immediately. Your data is kept but features above the Free plan limits become inactive.",
    },
    {
      question: "What happens to my data if I downgrade?",
      answer:
        "Your ZIP codes, delivery rules, waitlist entries, and widget settings are all preserved. However, features above your new plan's limits become inactive — for example, if you downgrade from Pro to Free, ZIP codes beyond 20 remain saved but won't be checked by the widget. Upgrade again and everything is restored instantly.",
    },
    // ── Technical ──
    {
      question: "Does Pinzo slow down my store?",
      answer:
        "No. The widget loads asynchronously and does not block your page from rendering. ZIP code checks are fast API calls with response caching (60 seconds for successful checks). The widget script is lightweight and served from your Shopify CDN.",
    },
    {
      question: "Does Pinzo work with all Shopify themes?",
      answer:
        "Yes — Pinzo works with all Online Store 2.0 themes (which includes all modern Shopify themes). It uses Shopify's Theme App Extension system, so there's no code editing required. If you're on a vintage (non-2.0) theme, contact us for manual installation support.",
    },
    {
      question: "What data does Pinzo store about my customers?",
      answer:
        "Pinzo only stores data that customers voluntarily provide through the waitlist form: their email address, name (optional), and the ZIP code they checked. No browsing data, IP addresses, or other personal information is collected. All customer data is deleted when you uninstall the app, as required by Shopify's privacy policies.",
    },
  ];

  return (
    <Page
      title="Help & Support"
      subtitle="Quick answers and ways to reach us"
      backAction={{ onAction: () => navigate("/app") }}
    >
      <Box paddingBlockEnd="1600">
        <Layout>

          {/* ----------------------------------------------------------------
              Section 1: FAQ Accordion
          ---------------------------------------------------------------- */}
          <Layout.Section>
            <Card padding="0">
              <Box padding="400" paddingBlockEnd="200">
                <Text as="h2" variant="headingLg" fontWeight="bold">
                  Frequently Asked Questions
                </Text>
              </Box>
              <Divider />
              {faqs.map((faq, index) => (
                <Box key={faq.question}>
                  {/* Interactive accordion trigger — Polaris has no clickable container
                      component, so a minimal div with role="button" is required here.
                      Background uses Polaris design tokens. */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => handleFaqToggle(index)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleFaqToggle(index);
                      }
                    }}
                    style={{
                      cursor: "pointer",
                      padding: "var(--p-space-400)",
                      background:
                        openFaq === index
                          ? "var(--p-color-bg-surface-hover)"
                          : "transparent",
                      transition: "background 150ms ease",
                    }}
                  >
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {faq.question}
                      </Text>
                      <Box>
                        <Icon
                          source={
                            openFaq === index
                              ? ChevronUpIcon
                              : ChevronDownIcon
                          }
                          tone="subdued"
                        />
                      </Box>
                    </InlineStack>
                  </div>
                  <Collapsible
                    open={openFaq === index}
                    id={`faq-${index}`}
                    transition={{
                      duration: "200ms",
                      timingFunction: "ease-in-out",
                    }}
                  >
                    <Box
                      padding="400"
                      paddingBlockStart="0"
                      background="bg-surface-hover"
                    >
                      <Text as="p" tone="subdued" variant="bodyMd">
                        {faq.answer}
                      </Text>
                    </Box>
                  </Collapsible>
                  {index < faqs.length - 1 && <Divider />}
                </Box>
              ))}
            </Card>
          </Layout.Section>

          {/* ----------------------------------------------------------------
              Section 2: Contact Support — 3-column cards
          ---------------------------------------------------------------- */}
          <Layout.Section>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Get in Touch
              </Text>
              <InlineStack gap="400" wrap align="start">

                {/* Live Chat */}
                <Box
                  minWidth="200px"
                  width="100%"
                  maxWidth="calc(33.333% - var(--p-space-300))"
                >
                  <Card>
                    <BlockStack gap="300" inlineAlign="center">
                      <Box
                        background="bg-surface-info"
                        borderRadius="full"
                        padding="300"
                      >
                        <Icon source={ChatIcon} tone="info" />
                      </Box>
                      <Text as="h3" variant="headingSm" alignment="center">
                        Live Chat
                      </Text>
                      <Text
                        as="p"
                        tone="subdued"
                        variant="bodySm"
                        alignment="center"
                      >
                        Chat with us directly for quick help and real-time
                        answers.
                      </Text>
                      <Button
                        variant="primary"
                        onClick={() => {
                          if (typeof window !== "undefined" && window.$chatwoot) {
                            window.$chatwoot.toggle("open");
                          }
                        }}
                      >
                        Start Chat
                      </Button>
                    </BlockStack>
                  </Card>
                </Box>

                {/* Email Support */}
                <Box
                  minWidth="200px"
                  width="100%"
                  maxWidth="calc(33.333% - var(--p-space-300))"
                >
                  <Card>
                    <BlockStack gap="300" inlineAlign="center">
                      <Box
                        background="bg-surface-success"
                        borderRadius="full"
                        padding="300"
                      >
                        <Icon source={EmailNewsletterIcon} tone="success" />
                      </Box>
                      <Text as="h3" variant="headingSm" alignment="center">
                        Email Us
                      </Text>
                      <Text
                        as="p"
                        tone="subdued"
                        variant="bodySm"
                        alignment="center"
                      >
                        Send us a detailed message and we&rsquo;ll respond
                        within 2-4 hours.
                      </Text>
                      <Button onClick={() => window.open("mailto:support@boldteq.com", "_blank")}>
                        Send Email
                      </Button>
                    </BlockStack>
                  </Card>
                </Box>

                {/* Feature Requests */}
                <Box
                  minWidth="200px"
                  width="100%"
                  maxWidth="calc(33.333% - var(--p-space-300))"
                >
                  <Card>
                    <BlockStack gap="300" inlineAlign="center">
                      <Box
                        background="bg-surface-warning"
                        borderRadius="full"
                        padding="300"
                      >
                        <Icon source={LightbulbIcon} tone="caution" />
                      </Box>
                      <Text as="h3" variant="headingSm" alignment="center">
                        Feature Requests
                      </Text>
                      <Text
                        as="p"
                        tone="subdued"
                        variant="bodySm"
                        alignment="center"
                      >
                        Have an idea to improve the app? We&rsquo;d love to
                        hear it.
                      </Text>
                      <Button
                        onClick={() => navigate("/app/feature-requests")}
                      >
                        Submit Idea
                      </Button>
                    </BlockStack>
                  </Card>
                </Box>

              </InlineStack>
            </BlockStack>
          </Layout.Section>

          {/* ----------------------------------------------------------------
              Section 3: Support Hours
          ---------------------------------------------------------------- */}
          <Layout.Section>
            <Box
              padding="500"
              background="bg-surface-secondary"
              borderRadius="300"
            >
              <BlockStack gap="400">
                <BlockStack gap="100" inlineAlign="center">
                  <Text as="h2" variant="headingMd" alignment="center">
                    We&rsquo;re here when you need us
                  </Text>
                </BlockStack>
                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                  <Box
                    padding="500"
                    background="bg-surface"
                    borderWidth="025"
                    borderColor="border"
                    borderRadius="300"
                  >
                    <BlockStack gap="300" inlineAlign="center">
                      <Box
                        background="bg-surface-info"
                        borderRadius="full"
                        padding="300"
                      >
                        <Icon source={CalendarTimeIcon} tone="info" />
                      </Box>
                      <Text as="h3" variant="headingSm" alignment="center">
                        Monday — Friday
                      </Text>
                      <Text as="p" variant="headingMd" alignment="center" fontWeight="bold">
                        9:00 AM — 6:00 PM IST
                      </Text>
                      <Badge tone="info">Full support available</Badge>
                    </BlockStack>
                  </Box>
                  <Box
                    padding="500"
                    background="bg-surface"
                    borderWidth="025"
                    borderColor="border"
                    borderRadius="300"
                  >
                    <BlockStack gap="300" inlineAlign="center">
                      <Box
                        background="bg-surface-success"
                        borderRadius="full"
                        padding="300"
                      >
                        <Icon source={SmileyHappyIcon} tone="success" />
                      </Box>
                      <Text as="h3" variant="headingSm" alignment="center">
                        Weekends
                      </Text>
                      <Text as="p" variant="headingMd" alignment="center" fontWeight="bold">
                        We still respond!
                      </Text>
                      <Badge tone="success">Replies may take a bit longer</Badge>
                    </BlockStack>
                  </Box>
                </InlineGrid>
              </BlockStack>
            </Box>
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

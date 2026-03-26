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
    {
      question: "How do I add the widget to my store?",
      answer:
        "Go to Online Store → Themes → Customize. Enable 'Pinzo' under App Embeds, then add the block to any page from the Apps section.",
    },
    {
      question: "How many ZIP codes can I add?",
      answer:
        "Depends on your plan. Free: 20 allowed ZIP codes. Starter: 500. Pro+: Unlimited.",
    },
    {
      question: "How does cart validation work?",
      answer:
        "Enable 'Block checkout for unserviceable ZIP codes' in Widget Settings (Pro plan required), then add the Cart Validator block to your cart page template in the Theme Editor.",
    },
    {
      question: "How does the waitlist work?",
      answer:
        "When delivery isn't available for a ZIP code, customers can join a waitlist. You can notify them from the Waitlist page when you expand to their area.",
    },
    {
      question: "Can I customize the widget appearance?",
      answer:
        "Yes — go to Widget Customization to change colors, text, position, and styling to match your brand.",
    },
    {
      question: "Can I restrict delivery to specific products?",
      answer:
        "Product-level ZIP rules are coming soon. This will let you restrict delivery for specific products to certain ZIP codes.",
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
                <div key={faq.question}>
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
                </div>
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

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
  List,
  Divider,
  Box,
  Banner,
} from "@shopify/polaris";

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

  const gettingStartedItems = [
    "How to add ZIP codes",
    "Setting up delivery rules",
    "Customizing the storefront widget",
    "Managing your waitlist",
  ];

  const faqs: Array<{ question: string; answer: string }> = [
    {
      question: "How many ZIP codes can I add?",
      answer:
        "Depends on your plan. Free: 20 allowed ZIP codes. Starter: 500. Pro+: Unlimited.",
    },
    {
      question: "Can I restrict delivery to specific products?",
      answer:
        "Product-level ZIP rules are coming soon. This feature will let you restrict delivery for specific products to certain ZIP codes. Stay tuned for updates!",
    },
    {
      question: "How does the waitlist work?",
      answer:
        "Customers enter their ZIP if delivery isn't available, and you can notify them when you start delivering.",
    },
    {
      question: "Can I customize the widget colors?",
      answer:
        "Yes, go to Widget Customization and choose colors that match your brand.",
    },
    {
      question: "What if I need more help?",
      answer: "Contact support or check our documentation.",
    },
  ];

  return (
    <Page
      title="Help & Support"
      subtitle="Resources and answers to help you get the most out of Zip Code Checker"
      backAction={{ onAction: () => navigate("/app") }}
    >
      <Box paddingBlockEnd="1600">
        <Layout>

          {/* ----------------------------------------------------------------
              Section 1: Getting Started
          ---------------------------------------------------------------- */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Getting Started
                </Text>
                <Divider />
                <Text as="p" tone="subdued" variant="bodyMd">
                  New to Zip Code Checker? These guides will help you get up and
                  running quickly.
                </Text>
                <List type="bullet">
                  {gettingStartedItems.map((item) => (
                    <List.Item key={item}>{item}</List.Item>
                  ))}
                  <List.Item>
                    <Text as="span" fontWeight="bold">Step 4 (Optional) — </Text>
                    Go to your Theme Editor, navigate to the Cart page, click Add block, and add the{" "}
                    <Text as="span" fontWeight="bold">Cart Validator</Text> block. This shows a warning
                    to customers with unserviceable ZIP codes before they check out.
                  </List.Item>
                </List>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ----------------------------------------------------------------
              Section 2: Common Questions
          ---------------------------------------------------------------- */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Common Questions
                </Text>
                <Divider />
                {faqs.map((faq, index) => (
                  <BlockStack key={faq.question} gap="200">
                    {index > 0 && <Divider />}
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {faq.question}
                    </Text>
                    <Text as="p" tone="subdued" variant="bodyMd">
                      {faq.answer}
                    </Text>
                  </BlockStack>
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ----------------------------------------------------------------
              Section 3: Support Hours
          ---------------------------------------------------------------- */}
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="start" gap="200">
                  <Text as="h2" variant="headingMd">
                    Support Hours
                  </Text>
                </InlineStack>
                <Divider />
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">Monday - Friday</Text>
                    <Text as="p" variant="bodyMd">9 AM - 6 PM IST</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">Saturday</Text>
                    <Text as="p" variant="bodyMd">10 AM - 4 PM IST</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">Sunday</Text>
                    <Text as="p" tone="subdued" variant="bodyMd">Closed</Text>
                  </InlineStack>
                </BlockStack>
                <Banner tone="success">
                  <Text as="p" variant="bodySm">
                    We typically respond within 2-4 hours during business hours.
                  </Text>
                </Banner>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ----------------------------------------------------------------
              Section 4: Still need help?
          ---------------------------------------------------------------- */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Still need help?
                </Text>
                <Divider />
                <Text as="p" tone="subdued" variant="bodyMd">
                  Can&rsquo;t find what you&rsquo;re looking for? Our support team is
                  always ready to help you succeed with Zip Code Checker.
                </Text>
                <InlineStack gap="300" wrap>
                  <Button
                    url="https://docs.zipcodechecker.app"
                    external
                  >
                    Documentation
                  </Button>
                  <Button
                    url="mailto:support@boldteq.com"
                    external
                    variant="primary"
                  >
                    Email Support
                  </Button>
                  <Button
                    url="https://feedback.zipcodechecker.app"
                    external
                  >
                    Feature Requests
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

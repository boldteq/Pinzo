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
  Badge,
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
              Section 1: Setup Guide
          ---------------------------------------------------------------- */}
          <Layout.Section>
            <Card>
              <BlockStack gap="600">
                <Text as="h2" variant="headingMd">
                  Setup Guide
                </Text>
                <Text as="p" tone="subdued" variant="bodyMd">
                  Follow these steps to get Zip Code Checker fully working on your storefront. The widget uses Shopify Theme App Extensions — no code changes required.
                </Text>

                {/* ---- A. Add the widget ---- */}
                <BlockStack gap="300">
                  <Divider />
                  <Text as="h3" variant="headingSm">
                    A. How to Add the Widget to Your Store
                  </Text>
                  <Text as="p" tone="subdued" variant="bodyMd">
                    The widget is a native Theme App Extension block. You add it directly inside the Shopify Theme Editor with no code required.
                  </Text>
                  <List type="number">
                    <List.Item>
                      Go to your Shopify Admin, then <Text as="span" fontWeight="semibold">Online Store → Themes</Text>.
                    </List.Item>
                    <List.Item>
                      Click <Text as="span" fontWeight="semibold">Customize</Text> on your active theme.
                    </List.Item>
                    <List.Item>
                      In the left sidebar, click <Text as="span" fontWeight="semibold">App Embeds</Text> and toggle on <Text as="span" fontWeight="semibold">Zip Code Checker</Text>.
                    </List.Item>
                    <List.Item>
                      Navigate to the page where you want the widget to appear (for example, a Product page).
                    </List.Item>
                    <List.Item>
                      Click <Text as="span" fontWeight="semibold">Add block</Text>, then under the Apps section select <Text as="span" fontWeight="semibold">Zip Code Checker</Text>.
                    </List.Item>
                    <List.Item>
                      Drag the block to your preferred position, then click <Text as="span" fontWeight="semibold">Save</Text>.
                    </List.Item>
                  </List>
                </BlockStack>

                {/* ---- B. Cart page validation ---- */}
                <BlockStack gap="300">
                  <Divider />
                  <InlineStack gap="200" align="start" blockAlign="center">
                    <Text as="h3" variant="headingSm">
                      B. How to Enable Cart Page Validation
                    </Text>
                    <Badge tone="attention">Pro Feature</Badge>
                  </InlineStack>
                  <Text as="p" tone="subdued" variant="bodyMd">
                    Cart validation blocks the checkout button when a customer has an unserviceable ZIP code. It requires the Pro plan and the Cart Validator block in your theme.
                  </Text>
                  <List type="number">
                    <List.Item>
                      In the Zip Code Checker app, go to <Text as="span" fontWeight="semibold">Widget Settings</Text>.
                    </List.Item>
                    <List.Item>
                      Enable the <Text as="span" fontWeight="semibold">Block checkout in cart for unserviceable ZIP codes</Text> toggle. This requires a Pro plan or higher.
                    </List.Item>
                    <List.Item>
                      Open your Shopify Theme Editor and navigate to the <Text as="span" fontWeight="semibold">Cart page</Text> template.
                    </List.Item>
                    <List.Item>
                      Click <Text as="span" fontWeight="semibold">Add block</Text>, then under the Apps section select <Text as="span" fontWeight="semibold">Cart Validator</Text>.
                    </List.Item>
                    <List.Item>
                      Click <Text as="span" fontWeight="semibold">Save</Text>. The cart will now block checkout for customers with an unvalidated or invalid ZIP code.
                    </List.Item>
                  </List>
                  <Banner tone="warning">
                    <Text as="p" variant="bodySm">
                      If the toggle is greyed out, upgrade to the Pro plan first from the Pricing page.
                    </Text>
                  </Banner>
                </BlockStack>

                {/* ---- C. How it works ---- */}
                <BlockStack gap="300">
                  <Divider />
                  <Text as="h3" variant="headingSm">
                    C. How It Works
                  </Text>
                  <Text as="p" tone="subdued" variant="bodyMd">
                    Understanding the flow helps you troubleshoot and explain the experience to customers.
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      Customer enters their ZIP code on the product page — the result is saved in their browser session.
                    </List.Item>
                    <List.Item>
                      When the customer navigates to the cart page, the Cart Validator block reads the saved result.
                    </List.Item>
                    <List.Item>
                      If the ZIP was invalid or unserviceable, the checkout button is disabled and a warning banner is shown.
                    </List.Item>
                    <List.Item>
                      If the ZIP was valid, everything works normally and checkout proceeds as usual.
                    </List.Item>
                    <List.Item>
                      The session result is cleared when the customer checks out or starts a new browsing session.
                    </List.Item>
                  </List>
                </BlockStack>

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
                    url="/app/feature-requests"
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

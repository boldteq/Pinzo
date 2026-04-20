import { useState, useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSearchParams, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { detectThemeEmbed } from "../utils/theme-detection.server";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  Box,
  ProgressBar,
  Badge,
  Divider,
  List,
} from "@shopify/polaris";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const [zipCount, themeInfo] = await Promise.all([
    db.zipCode.count({ where: { shop } }),
    detectThemeEmbed(shop, admin),
  ]);

  return { zipCount, ...themeInfo };
};

const TOTAL_STEPS = 5;

function StepIndicator({ current, total }: { current: number; total: number }) {
  const progress = Math.round(((current - 1) / total) * 100);
  return (
    <div role="status" aria-label={`Step ${current} of ${total}`}>
      <BlockStack gap="200">
        <InlineStack align="space-between">
          <Text as="p" variant="bodySm" tone="subdued">
            Step {current} of {total}
          </Text>
          <Text as="p" variant="bodySm" fontWeight="semibold">
            {progress}% complete
          </Text>
        </InlineStack>
        <ProgressBar progress={progress} size="small" tone="highlight" />
      </BlockStack>
    </div>
  );
}

export default function OnboardingPage() {
  const { zipCount, appEmbedEnabled, themeEditorUrl, themeEditorAppEmbedsUrl } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const stepParam = parseInt(searchParams.get("step") ?? "1", 10);
  const isValidStep = !isNaN(stepParam) && stepParam >= 1 && stepParam <= TOTAL_STEPS;
  if (!isValidStep) {
    console.warn("[onboarding] Invalid step param:", searchParams.get("step"));
  }
  const step = isValidStep ? stepParam : 1;

  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem("zcc-onboarding-complete") === "true") {
        setIsComplete(true);
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  const goToStep = (n: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("step", String(n));
    setSearchParams(next);
  };

  const handleComplete = () => {
    try {
      localStorage.setItem("zcc-onboarding-complete", "true");
    } catch {
      // localStorage unavailable
    }
    navigate("/app");
  };

  // Step 1: Welcome
  if (step === 1) {
    return (
      <Page title="Welcome to Pinzo" backAction={{ onAction: () => navigate("/app") }}>
        <Box maxWidth="640px">
          <BlockStack gap="500">
            <StepIndicator current={1} total={TOTAL_STEPS} />
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingLg">Let&apos;s get your ZIP checker live in 4 steps</Text>
                  <Text as="p" tone="subdued">
                    Follow this guide to set up Pinzo correctly. It takes about 5 minutes.
                  </Text>
                </BlockStack>
                <Divider />
                <BlockStack gap="300">
                  {[
                    { n: 1, title: "Add your ZIP codes", desc: "Define which areas you deliver to" },
                    { n: 2, title: "Customize the widget", desc: "Match your store's colors and style" },
                    { n: 3, title: "Enable the app embed", desc: "Activate Pinzo in your live theme" },
                    { n: 4, title: "Test on your storefront", desc: "Confirm everything is working" },
                  ].map((item) => (
                    <InlineStack key={item.n} gap="300" blockAlign="center">
                      <div style={{
                        width: 32, height: 32, borderRadius: "50%",
                        background: "#6366F1",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#fff", fontWeight: 700, fontSize: 13, flexShrink: 0,
                      }}>{item.n}</div>
                      <BlockStack gap="050">
                        <Text as="p" fontWeight="semibold">{item.title}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">{item.desc}</Text>
                      </BlockStack>
                    </InlineStack>
                  ))}
                </BlockStack>
                <Divider />
                <InlineStack align="end">
                  <Button variant="primary" onClick={() => goToStep(2)}>Get Started</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Box>
      </Page>
    );
  }

  // Step 2: Add ZIP Codes
  if (step === 2) {
    return (
      <Page title="Add ZIP Codes" backAction={{ onAction: () => goToStep(1) }}>
        <Box maxWidth="640px">
          <BlockStack gap="500">
            <StepIndicator current={2} total={TOTAL_STEPS} />
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Step 1 — Add your ZIP codes</Text>
                  {zipCount > 0 && <Badge tone="success">{`${zipCount} added`}</Badge>}
                </InlineStack>
                <Divider />
                <Text as="p" tone="subdued">
                  Add all the ZIP codes you deliver to. You can type them one by one, bulk import via CSV, or add them later. The widget will check against this list in real-time.
                </Text>
                <List>
                  <List.Item>Allowed ZIP codes show a success message to customers</List.Item>
                  <List.Item>Blocked ZIP codes show a &quot;not available&quot; message</List.Item>
                  <List.Item>ZIP codes not in your list follow your default behavior (Settings)</List.Item>
                </List>
                <InlineStack gap="300">
                  <Button variant="primary" url="/app/zip-codes">Go to ZIP Codes</Button>
                  <Button onClick={() => goToStep(3)}>
                    {zipCount > 0 ? "Looks good, continue" : "I'll add them later"}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Box>
      </Page>
    );
  }

  // Step 3: Customize Widget
  if (step === 3) {
    return (
      <Page title="Customize Widget" backAction={{ onAction: () => goToStep(2) }}>
        <Box maxWidth="640px">
          <BlockStack gap="500">
            <StepIndicator current={3} total={TOTAL_STEPS} />
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Step 2 — Customize the widget</Text>
                <Divider />
                <Text as="p" tone="subdued">
                  Make the ZIP code checker match your store&apos;s look and feel. Choose colors, text, and layout — or pick a prebuilt template to get started fast.
                </Text>
                <List>
                  <List.Item>Choose from 5 prebuilt color templates</List.Item>
                  <List.Item>Customize button text, placeholder, and messages</List.Item>
                  <List.Item>Set the widget position (inline, floating, or popup)</List.Item>
                </List>
                <InlineStack gap="300">
                  <Button variant="primary" url="/app/widget">Customize Widget</Button>
                  <Button onClick={() => goToStep(4)}>Continue</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Box>
      </Page>
    );
  }

  // Step 4: Enable Embed
  if (step === 4) {
    return (
      <Page title="Enable App Embed" backAction={{ onAction: () => goToStep(3) }}>
        <Box maxWidth="640px">
          <BlockStack gap="500">
            <StepIndicator current={4} total={TOTAL_STEPS} />
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Step 3 — Enable App Embed</Text>
                  {appEmbedEnabled && <Badge tone="success">Done</Badge>}
                </InlineStack>
                <Divider />
                {appEmbedEnabled ? (
                  <Banner tone="success">
                    Pinzo is active in your theme. The widget is live on your storefront.
                  </Banner>
                ) : (
                  <Banner tone="warning">
                    The app embed is not enabled yet. Follow the steps below.
                  </Banner>
                )}
                <Text as="p" tone="subdued">
                  The app embed must be enabled for the widget to appear on your store. This is a one-time step in the Theme Editor.
                </Text>
                <List type="number">
                  <List.Item>
                    Click <strong>Open App Embeds</strong> below
                  </List.Item>
                  <List.Item>
                    Find <strong>Pinzo</strong> in the App Embeds list and toggle it on
                  </List.Item>
                  <List.Item>
                    Navigate to your <strong>Product template</strong>, add the <strong>Pinzo block</strong>, and save
                  </List.Item>
                </List>
                <InlineStack gap="300">
                  <Button variant="primary" url={themeEditorAppEmbedsUrl} external>
                    Open App Embeds
                  </Button>
                  <Button url={themeEditorUrl} external>Theme Editor</Button>
                  <Button onClick={() => goToStep(5)}>Continue</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Box>
      </Page>
    );
  }

  // Step 5: Done
  return (
    <Page title="You're All Set!" backAction={{ onAction: () => goToStep(4) }}>
      <Box maxWidth="640px">
        <BlockStack gap="500">
          <StepIndicator current={5} total={TOTAL_STEPS} />
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">Setup complete!</Text>
              <Divider />
              {isComplete ? (
                <Banner tone="success">You&apos;ve completed the Pinzo setup guide.</Banner>
              ) : (
                <Text as="p" tone="subdued">
                  Pinzo is configured and ready. Here&apos;s what to explore next:
                </Text>
              )}
              <BlockStack gap="300">
                {[
                  { title: "View ZIP Codes", desc: "Add, edit, or import more ZIP codes", href: "/app/zip-codes" },
                  { title: "Analytics", desc: "See how many ZIP checks are happening on your store", href: "/app/analytics" },
                  { title: "Delivery Rules", desc: "Set delivery fees and cutoff times by zone", href: "/app/delivery-rules" },
                  { title: "Waitlist", desc: "See which customers want delivery to new areas", href: "/app/waitlist" },
                ].map((item) => (
                  <InlineStack key={item.title} align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text as="p" fontWeight="semibold">{item.title}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">{item.desc}</Text>
                    </BlockStack>
                    <Button size="slim" url={item.href}>Go</Button>
                  </InlineStack>
                ))}
              </BlockStack>
              <Divider />
              <InlineStack align="end">
                <Button variant="primary" onClick={handleComplete}>Go to Dashboard</Button>
              </InlineStack>
            </BlockStack>
          </Card>
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

import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";

declare global {
  interface Window {
    $chatwoot?: { toggle: (action: string) => void };
    chatwootSettings?: Record<string, unknown>;
    chatwootSDK?: { run: (config: { websiteToken: string; baseUrl: string }) => void };
  }
}
import { Outlet, useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import {
  AppProvider as PolarisAppProvider,
  SkeletonPage,
  Layout,
  Card,
  SkeletonBodyText,
  SkeletonDisplayText,
} from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";
import enTranslations from "@shopify/polaris/locales/en.json";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

// Skeleton shown during page-to-page navigation transitions inside the app shell.
// useNavigation must be called inside PolarisAppProvider so Polaris context is available.
function AppContent() {
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";

  if (isNavigating) {
    return (
      <SkeletonPage primaryAction>
        <Layout>
          <Layout.Section>
            <Card>
              <SkeletonDisplayText size="small" />
              <SkeletonBodyText lines={3} />
            </Card>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <SkeletonBodyText lines={6} />
            </Card>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <SkeletonBodyText lines={4} />
            </Card>
          </Layout.Section>
        </Layout>
      </SkeletonPage>
    );
  }

  return <Outlet />;
}

function ChatwootWidget() {
  useEffect(() => {
    // Skip if already loaded
    if (window.$chatwoot) return;

    window.chatwootSettings = {
      position: "right",
      type: "standard",
      launcherTitle: "",
    };

    const BASE_URL = "https://app.chatwoot.com";
    const script = document.createElement("script");
    script.src = `${BASE_URL}/packs/js/sdk.js`;
    script.async = true;
    script.onload = () => {
      window.chatwootSDK?.run({
        websiteToken: "F2gCECkLD25SAkJ92AcVui4x",
        baseUrl: BASE_URL,
      });
    };
    document.body.appendChild(script);
  }, []);

  return null;
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={enTranslations}>
        <ChatwootWidget />
        <s-app-nav>
          <s-link href="/app/zip-codes">Zip Codes</s-link>
          <s-link href="/app/delivery-rules">Delivery Rules</s-link>
          <s-link href="/app/waitlist">Waitlist</s-link>
          <s-link href="/app/widget">Widget Customization</s-link>
          <s-link href="/app/settings">Settings</s-link>
          <s-link href="/app/help">Help &amp; Support</s-link>
        </s-app-nav>
        <AppContent />
      </PolarisAppProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

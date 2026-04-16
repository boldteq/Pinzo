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
import { NavMenu } from "@shopify/app-bridge-react";
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

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    chatwootToken: process.env.CHATWOOT_WEBSITE_TOKEN || "",
  };
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

function ChatwootWidget({ token }: { token: string }) {
  useEffect(() => {
    if (!token || window.$chatwoot) return;

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
        websiteToken: token,
        baseUrl: BASE_URL,
      });
    };
    document.body.appendChild(script);
  }, [token]);

  return null;
}

export default function App() {
  const { apiKey, chatwootToken } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={enTranslations}>
        <ChatwootWidget token={chatwootToken} />
        <NavMenu>
          <a href="/app">Dashboard</a>
          <a href="/app/analytics">Analytics</a>
          <a href="/app/zip-codes">Zip Codes</a>
          <a href="/app/delivery-rules">Delivery Rules</a>
          <a href="/app/waitlist">Waitlist</a>
          <a href="/app/widget">Widget Customization</a>
          <a href="/app/settings">Settings</a>
          <a href="/app/feature-requests">Feature Requests</a>
          <a href="/app/help">Help &amp; Support</a>
        </NavMenu>
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

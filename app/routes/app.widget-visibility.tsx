import { useState, useCallback, useEffect, useRef } from "react";
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
import db from "../db.server";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  Divider,
  Box,
  ChoiceList,
  Tag,
  Badge,
} from "@shopify/polaris";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [widgetConfig, subscription] = await Promise.all([
    db.widgetConfig.findUnique({ where: { shop } }),
    getShopSubscription(shop),
  ]);

  return {
    visibilityMode: widgetConfig?.visibilityMode ?? "all_products",
    visibilityProductIds: widgetConfig?.visibilityProductIds ?? "",
    visibilityCollectionIds: widgetConfig?.visibilityCollectionIds ?? "",
    visibilityPages: widgetConfig?.visibilityPages ?? "product",
    subscription,
  };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();

  const visibilityMode = String(formData.get("visibilityMode") || "all_products");
  const visibilityProductIds = String(formData.get("visibilityProductIds") || "");
  const visibilityCollectionIds = String(formData.get("visibilityCollectionIds") || "");
  const visibilityPages = String(formData.get("visibilityPages") || "product");

  try {
    await db.widgetConfig.upsert({
      where: { shop },
      create: {
        shop,
        visibilityMode,
        visibilityProductIds: visibilityProductIds || null,
        visibilityCollectionIds: visibilityCollectionIds || null,
        visibilityPages: visibilityPages || null,
      },
      update: {
        visibilityMode,
        visibilityProductIds: visibilityProductIds || null,
        visibilityCollectionIds: visibilityCollectionIds || null,
        visibilityPages: visibilityPages || null,
      },
    });
    return { success: true };
  } catch {
    return { error: "Failed to save visibility settings." };
  }
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WidgetVisibilityPage() {
  const { visibilityMode: initMode, visibilityProductIds: initProductIds, visibilityCollectionIds: initCollectionIds, visibilityPages: initPages, subscription } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const limits = subscription.limits;

  // State
  const [visibilityMode, setVisibilityMode] = useState([initMode]);
  const [productIds, setProductIds] = useState<string[]>(
    initProductIds ? initProductIds.split(",").filter(Boolean) : [],
  );
  const [productNames, setProductNames] = useState<Record<string, string>>({});
  const [collectionIds, setCollectionIds] = useState<string[]>(
    initCollectionIds ? initCollectionIds.split(",").filter(Boolean) : [],
  );
  const [collectionNames, setCollectionNames] = useState<Record<string, string>>({});
  const [selectedPages, setSelectedPages] = useState<string[]>(
    initPages ? initPages.split(",").filter(Boolean) : ["product"],
  );

  const prevFetcherState = useRef(fetcher.state);
  useEffect(() => {
    if (
      prevFetcherState.current === "submitting" &&
      fetcher.state === "idle" &&
      fetcher.data &&
      "success" in fetcher.data &&
      fetcher.data.success
    ) {
      shopify.toast.show("Saved");
    }
    prevFetcherState.current = fetcher.state;
  }, [fetcher.state, fetcher.data, shopify]);

  const handleSelectProducts = useCallback(async () => {
    const selection = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: productIds.map((id) => ({ id: `gid://shopify/Product/${id}` })),
    });
    if (selection) {
      const ids = selection.map((p) => p.id.split("/").pop()).filter((id): id is string => !!id);
      const names: Record<string, string> = {};
      selection.forEach((p) => {
        const id = p.id.split("/").pop();
        if (id) names[id] = p.title;
      });
      setProductIds(ids);
      setProductNames(names);
    }
  }, [shopify, productIds]);

  const handleSelectCollections = useCallback(async () => {
    const selection = await shopify.resourcePicker({
      type: "collection",
      multiple: true,
      selectionIds: collectionIds.map((id) => ({ id: `gid://shopify/Collection/${id}` })),
    });
    if (selection) {
      const ids = selection.map((c) => c.id.split("/").pop()).filter((id): id is string => !!id);
      const names: Record<string, string> = {};
      selection.forEach((c) => {
        const id = c.id.split("/").pop();
        if (id) names[id] = c.title;
      });
      setCollectionIds(ids);
      setCollectionNames(names);
    }
  }, [shopify, collectionIds]);

  const handleSave = useCallback(() => {
    const fd = new FormData();
    fd.append("visibilityMode", visibilityMode[0]);
    fd.append("visibilityProductIds", productIds.join(","));
    fd.append("visibilityCollectionIds", collectionIds.join(","));
    fd.append("visibilityPages", selectedPages.join(","));
    fetcher.submit(fd, { method: "post" });
  }, [fetcher, visibilityMode, productIds, collectionIds, selectedPages]);

  const currentMode = visibilityMode[0];

  if (!limits.widgetVisibility) {
    return (
      <Page
        title="Widget Visibility"
        backAction={{ onAction: () => navigate("/app/widget") }}
      >
        <Layout>
          <Layout.Section>
            <Banner
              title="Widget Visibility is a Starter+ feature"
              tone="info"
              action={{ content: "Upgrade Plan", url: "/app/pricing" }}
            >
              <p>
                Upgrade to Starter or higher to control which pages and products
                the ZIP code widget appears on.
              </p>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Widget Visibility"
      subtitle="Control where the ZIP code widget appears on your store"
      backAction={{ onAction: () => navigate("/app/widget") }}
      primaryAction={{
        content: "Save",
        onAction: handleSave,
        loading: fetcher.state !== "idle",
      }}
    >
      <Box paddingBlockEnd="1600">
        <Layout>
          {fetcher.data && "error" in fetcher.data && fetcher.data.error && (
            <Layout.Section>
              <Banner tone="critical">{fetcher.data.error}</Banner>
            </Layout.Section>
          )}

          {/* Visibility Mode */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Where to Show the Widget</Text>
                <Divider />
                <ChoiceList
                  title="Show widget on"
                  titleHidden
                  choices={[
                    {
                      label: "All product pages (recommended)",
                      value: "all_products",
                      helpText: "Widget appears on every product page. Best for stores delivering everywhere.",
                    },
                    {
                      label: "Specific products only",
                      value: "specific_products",
                      helpText: "Choose exactly which products show the widget.",
                    },
                    {
                      label: "Specific collections only",
                      value: "specific_collections",
                      helpText: "Show widget only for products in selected collections.",
                    },
                    {
                      label: "All pages (product, cart, home, collection)",
                      value: "all_pages",
                      helpText: "Widget appears everywhere across the store.",
                    },
                  ]}
                  selected={visibilityMode}
                  onChange={setVisibilityMode}
                />

                {/* Product picker */}
                {currentMode === "specific_products" && (
                  <Box paddingBlockStart="300">
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="p" variant="headingSm">Selected Products</Text>
                        <Button onClick={handleSelectProducts} size="slim">
                          {productIds.length > 0 ? "Change Products" : "Select Products"}
                        </Button>
                      </InlineStack>
                      {productIds.length === 0 ? (
                        <Banner tone="warning">No products selected — the widget will not appear on any product page.</Banner>
                      ) : (
                        <InlineStack gap="200" wrap>
                          {productIds.map((id) => (
                            <Tag key={id} onRemove={() => setProductIds((prev) => prev.filter((p) => p !== id))}>
                              {productNames[id] ?? `Product ${id}`}
                            </Tag>
                          ))}
                        </InlineStack>
                      )}
                    </BlockStack>
                  </Box>
                )}

                {/* Collection picker */}
                {currentMode === "specific_collections" && (
                  <Box paddingBlockStart="300">
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="p" variant="headingSm">Selected Collections</Text>
                        <Button onClick={handleSelectCollections} size="slim">
                          {collectionIds.length > 0 ? "Change Collections" : "Select Collections"}
                        </Button>
                      </InlineStack>
                      {collectionIds.length === 0 ? (
                        <Banner tone="warning">No collections selected — the widget will not appear on any product page.</Banner>
                      ) : (
                        <InlineStack gap="200" wrap>
                          {collectionIds.map((id) => (
                            <Tag key={id} onRemove={() => setCollectionIds((prev) => prev.filter((c) => c !== id))}>
                              {collectionNames[id] ?? `Collection ${id}`}
                            </Tag>
                          ))}
                        </InlineStack>
                      )}
                    </BlockStack>
                  </Box>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Page Types */}
          {currentMode === "all_pages" && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Page Types</Text>
                    <Badge tone="info">All Pages mode</Badge>
                  </InlineStack>
                  <Divider />
                  <ChoiceList
                    title="Show on these page types"
                    allowMultiple
                    choices={[
                      { label: "Product pages", value: "product" },
                      { label: "Cart page", value: "cart" },
                      { label: "Collection pages", value: "collection" },
                      { label: "Home page", value: "home" },
                    ]}
                    selected={selectedPages}
                    onChange={setSelectedPages}
                  />
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {/* Info Card */}
          <Layout.Section>
            <Banner tone="info">
              <p>
                Visibility settings work together with your theme extension. After saving, the ZIP code widget block will only render on the configured pages and products. Changes take effect immediately on your storefront.
              </p>
            </Banner>
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

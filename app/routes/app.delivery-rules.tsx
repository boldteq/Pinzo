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
import db from "../db.server";
import { getShopSubscription } from "../billing.server";
import { PLAN_LIMITS, UNLIMITED } from "../plans";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  Button,
  TextField,
  Select,
  Modal,
  IndexTable,
  useIndexResourceState,
  EmptyState,
  Divider,
  Box,
  Tooltip,
  Checkbox,
  Banner,
  ChoiceList,
  Tag,
} from "@shopify/polaris";
import { PlusIcon, DeleteIcon, EditIcon, ViewIcon, HideIcon } from "@shopify/polaris-icons";

const DAYS_OPTIONS = [
  { label: "Monday", value: "Mon" },
  { label: "Tuesday", value: "Tue" },
  { label: "Wednesday", value: "Wed" },
  { label: "Thursday", value: "Thu" },
  { label: "Friday", value: "Fri" },
  { label: "Saturday", value: "Sat" },
  { label: "Sunday", value: "Sun" },
];

interface ProductNameNode {
  id: string;
  title: string;
}

interface NodesQueryResponse {
  data?: {
    nodes?: Array<ProductNameNode | null>;
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Check if merchant has approved read_products scope
  const hasProductScope = session.scope?.includes("read_products") ?? false;

  const [rules, zones, subscription] = await Promise.all([
    db.deliveryRule.findMany({
      where: { shop },
      orderBy: { priority: "asc" },
    }),
    db.zipCode.findMany({
      where: { shop, zone: { not: null } },
      select: { zone: true },
      distinct: ["zone"],
    }),
    getShopSubscription(shop),
  ]);

  // Batch-fetch names for rules that target specific products or collections
  let productNames: Record<string, string> = {};
  let collectionNames: Record<string, string> = {};

  if (hasProductScope) {
    const allProductIds = new Set<string>();
    const allCollectionIds = new Set<string>();

    for (const rule of rules) {
      if (rule.targetType === "products" && rule.productIds) {
        rule.productIds.split(",").forEach((id) => allProductIds.add(id.trim()));
      }
      if (rule.targetType === "collections" && rule.collectionIds) {
        rule.collectionIds
          .split(",")
          .forEach((id) => allCollectionIds.add(id.trim()));
      }
    }

    try {
      if (allProductIds.size > 0) {
        const productGids = [...allProductIds].map(
          (id) => `gid://shopify/Product/${id}`,
        );
        const response = await admin.graphql(
          `#graphql
          query ProductNames($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Product {
                id
                title
              }
            }
          }`,
          { variables: { ids: productGids } },
        );
        const data = (await response.json()) as NodesQueryResponse;
        for (const node of data?.data?.nodes ?? []) {
          if (node?.id && node?.title) {
            const numId = node.id.match(/\/(\d+)$/)?.[1];
            if (numId) productNames[numId] = node.title;
          }
        }
      }

      if (allCollectionIds.size > 0) {
        const collectionGids = [...allCollectionIds].map(
          (id) => `gid://shopify/Collection/${id}`,
        );
        const response = await admin.graphql(
          `#graphql
          query CollectionNames($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Collection {
                id
                title
              }
            }
          }`,
          { variables: { ids: collectionGids } },
        );
        const data = (await response.json()) as NodesQueryResponse;
        for (const node of data?.data?.nodes ?? []) {
          if (node?.id && node?.title) {
            const numId = node.id.match(/\/(\d+)$/)?.[1];
            if (numId) collectionNames[numId] = node.title;
          }
        }
      }
    } catch {
      // Non-critical — names are cosmetic; fall back to showing IDs
    }
  }

  return {
    rules,
    zones: zones.map((z) => z.zone).filter(Boolean) as string[],
    subscription,
    hasProductScope,
    productNames,
    collectionNames,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create" || intent === "update") {
    const id = String(formData.get("id") || "");
    const name = String(formData.get("name") || "").trim();
    const zone = String(formData.get("zone") || "").trim() || null;
    const zipCodes = String(formData.get("zipCodes") || "").trim() || null;
    const minOrderAmount = formData.get("minOrderAmount")
      ? parseFloat(String(formData.get("minOrderAmount")))
      : null;
    const deliveryFee = formData.get("deliveryFee")
      ? parseFloat(String(formData.get("deliveryFee")))
      : null;
    const freeShippingAbove = formData.get("freeShippingAbove")
      ? parseFloat(String(formData.get("freeShippingAbove")))
      : null;
    const estimatedDays =
      String(formData.get("estimatedDays") || "").trim() || null;
    const cutoffTime =
      String(formData.get("cutoffTime") || "").trim() || null;
    const daysOfWeek =
      String(formData.get("daysOfWeek") || "").trim() || null;
    const priority = parseInt(String(formData.get("priority") || "0"), 10);

    // Product/Collection targeting fields
    const targetType =
      (String(formData.get("targetType") || "all") as
        | "all"
        | "products"
        | "collections") || "all";
    const productIds =
      String(formData.get("productIds") || "").trim() || null;
    const collectionIds =
      String(formData.get("collectionIds") || "").trim() || null;

    if (!name) return { error: "Rule name is required." };

    // Plan-gating for product/collection targeting
    if (targetType !== "all") {
      const subscription = await getShopSubscription(shop);
      if (!subscription.limits.productCollectionRules) {
        return {
          error: `Product and collection targeting requires the Pro plan or higher. Upgrade to use this feature.`,
        };
      }
    }

    const data = {
      name,
      zone,
      zipCodes,
      minOrderAmount,
      deliveryFee,
      freeShippingAbove,
      estimatedDays,
      cutoffTime,
      daysOfWeek,
      priority,
      targetType,
      productIds,
      collectionIds,
    };

    if (intent === "update" && id) {
      try {
        const existing = await db.deliveryRule.findFirst({ where: { id, shop } });
        if (!existing) return { error: "Rule not found." };
        await db.deliveryRule.update({ where: { id }, data });
        return { success: true, action: "updated" };
      } catch {
        return { error: "Failed to update rule." };
      }
    } else {
      // Plan-gating: check limits before creating a new rule
      const subscription = await getShopSubscription(shop);
      const { maxDeliveryRules, label: planLabel } = subscription.limits;

      if (maxDeliveryRules === 0) {
        return {
          error:
            "Delivery rules are not available on the Free plan. Upgrade to Starter or Pro.",
        };
      }

      if (maxDeliveryRules < UNLIMITED) {
        const currentCount = await db.deliveryRule.count({ where: { shop } });
        if (currentCount >= maxDeliveryRules) {
          return {
            error: `You've reached the ${maxDeliveryRules} delivery rule limit on the ${planLabel} plan. Upgrade to Pro for unlimited rules.`,
          };
        }
      }

      await db.deliveryRule.create({ data: { shop, ...data } });
      return { success: true, action: "created" };
    }
  }

  if (intent === "delete") {
    const id = String(formData.get("id"));
    try {
      const existing = await db.deliveryRule.findFirst({ where: { id, shop } });
      if (!existing) return { error: "Rule not found." };
      await db.deliveryRule.delete({ where: { id } });
      return { success: true, action: "deleted" };
    } catch {
      return { error: "Failed to delete rule." };
    }
  }

  if (intent === "toggle") {
    const id = String(formData.get("id"));
    const isActive = formData.get("isActive") === "true";
    try {
      const existing = await db.deliveryRule.findFirst({ where: { id, shop } });
      if (!existing) return { error: "Rule not found." };
      await db.deliveryRule.update({
        where: { id },
        data: { isActive: !isActive },
      });
      return { success: true, action: "toggled" };
    } catch {
      return { error: "Failed to toggle rule." };
    }
  }

  if (intent === "bulk-delete") {
    const ids = String(formData.get("ids") || "").split(",").filter(Boolean);
    if (ids.length === 0) return { error: "No rules selected." };
    try {
      await db.deliveryRule.deleteMany({ where: { id: { in: ids }, shop } });
      return { success: true, action: "bulk-deleted" };
    } catch {
      return { error: "Failed to delete rules." };
    }
  }

  if (intent === "bulk-toggle") {
    const ids = String(formData.get("ids") || "").split(",").filter(Boolean);
    const active = formData.get("active") === "true";
    if (ids.length === 0) return { error: "No rules selected." };
    try {
      await db.deliveryRule.updateMany({
        where: { id: { in: ids }, shop },
        data: { isActive: active },
      });
      return { success: true, action: active ? "bulk-activated" : "bulk-deactivated" };
    } catch {
      return { error: "Failed to update rules." };
    }
  }

  return null;
};

type Rule = {
  id: string;
  name: string;
  zone: string | null;
  zipCodes: string | null;
  minOrderAmount: number | null;
  deliveryFee: number | null;
  freeShippingAbove: number | null;
  estimatedDays: string | null;
  cutoffTime: string | null;
  daysOfWeek: string | null;
  isActive: boolean;
  priority: number;
  targetType: string;
  productIds: string | null;
  collectionIds: string | null;
};

export default function DeliveryRulesPage() {
  const { rules, zones, subscription, hasProductScope, productNames, collectionNames } =
    useLoaderData<typeof loader>();
  const limits = PLAN_LIMITS[subscription.planTier];
  const isFreePlan = limits.maxDeliveryRules === 0;
  const hasFiniteLimit = limits.maxDeliveryRules < UNLIMITED && !isFreePlan;
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();

  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } =
    useIndexResourceState(rules as Rule[]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState(false);

  // Form state — existing fields
  const [name, setName] = useState("");
  const [zone, setZone] = useState("");
  const [zipCodes, setZipCodes] = useState("");
  const [minOrderAmount, setMinOrderAmount] = useState("");
  const [deliveryFee, setDeliveryFee] = useState("");
  const [freeShippingAbove, setFreeShippingAbove] = useState("");
  const [estimatedDays, setEstimatedDays] = useState("");
  const [cutoffTime, setCutoffTime] = useState("");
  const [selectedDays, setSelectedDays] = useState<string[]>([
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
  ]);
  const [priority, setPriority] = useState("0");

  // Form state — product/collection targeting fields
  const [targetType, setTargetType] = useState<"all" | "products" | "collections">("all");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [selectedProductNames, setSelectedProductNames] = useState<
    Record<string, string>
  >({});
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);
  const [selectedCollectionNames, setSelectedCollectionNames] = useState<
    Record<string, string>
  >({});

  const actionError =
    fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;

  const isDeleteLoading =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "delete";
  const isBulkDeleteLoading =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "bulk-delete";

  const resetForm = useCallback(() => {
    setName("");
    setZone("");
    setZipCodes("");
    setMinOrderAmount("");
    setDeliveryFee("");
    setFreeShippingAbove("");
    setEstimatedDays("");
    setCutoffTime("");
    setSelectedDays(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    setPriority("0");
    setTargetType("all");
    setSelectedProductIds([]);
    setSelectedProductNames({});
    setSelectedCollectionIds([]);
    setSelectedCollectionNames({});
    setEditingRule(null);
  }, []);

  const openCreate = useCallback(() => {
    resetForm();
    setModalOpen(true);
  }, [resetForm]);

  const openEdit = useCallback(
    (rule: Rule) => {
      setEditingRule(rule);
      setName(rule.name);
      setZone(rule.zone || "");
      setZipCodes(rule.zipCodes || "");
      setMinOrderAmount(rule.minOrderAmount != null ? String(rule.minOrderAmount) : "");
      setDeliveryFee(rule.deliveryFee != null ? String(rule.deliveryFee) : "");
      setFreeShippingAbove(
        rule.freeShippingAbove != null ? String(rule.freeShippingAbove) : "",
      );
      setEstimatedDays(rule.estimatedDays || "");
      setCutoffTime(rule.cutoffTime || "");
      setSelectedDays(rule.daysOfWeek ? rule.daysOfWeek.split(",") : []);
      setPriority(String(rule.priority));

      // Populate targeting fields from existing rule data
      const tt = (rule.targetType || "all") as "all" | "products" | "collections";
      setTargetType(tt);

      if (tt === "products" && rule.productIds) {
        const ids = rule.productIds.split(",").map((id) => id.trim()).filter(Boolean);
        setSelectedProductIds(ids);
        const names: Record<string, string> = {};
        ids.forEach((id) => {
          if (productNames[id]) names[id] = productNames[id];
        });
        setSelectedProductNames(names);
      } else {
        setSelectedProductIds([]);
        setSelectedProductNames({});
      }

      if (tt === "collections" && rule.collectionIds) {
        const ids = rule.collectionIds.split(",").map((id) => id.trim()).filter(Boolean);
        setSelectedCollectionIds(ids);
        const names: Record<string, string> = {};
        ids.forEach((id) => {
          if (collectionNames[id]) names[id] = collectionNames[id];
        });
        setSelectedCollectionNames(names);
      } else {
        setSelectedCollectionIds([]);
        setSelectedCollectionNames({});
      }

      setModalOpen(true);
    },
    [productNames, collectionNames],
  );

  const handleSave = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", editingRule ? "update" : "create");
    if (editingRule) fd.set("id", editingRule.id);
    fd.set("name", name);
    fd.set("zone", zone);
    fd.set("zipCodes", zipCodes);
    fd.set("minOrderAmount", minOrderAmount);
    fd.set("deliveryFee", deliveryFee);
    fd.set("freeShippingAbove", freeShippingAbove);
    fd.set("estimatedDays", estimatedDays);
    fd.set("cutoffTime", cutoffTime);
    fd.set("daysOfWeek", selectedDays.join(","));
    fd.set("priority", priority);
    fd.set("targetType", targetType);
    fd.set("productIds", selectedProductIds.join(","));
    fd.set("collectionIds", selectedCollectionIds.join(","));
    fetcher.submit(fd, { method: "POST" });
  }, [
    editingRule,
    name,
    zone,
    zipCodes,
    minOrderAmount,
    deliveryFee,
    freeShippingAbove,
    estimatedDays,
    cutoffTime,
    selectedDays,
    priority,
    targetType,
    selectedProductIds,
    selectedCollectionIds,
    fetcher,
  ]);

  const doDelete = useCallback(
    (id: string) => {
      const fd = new FormData();
      fd.set("intent", "delete");
      fd.set("id", id);
      fetcher.submit(fd, { method: "POST" });
      setConfirmDeleteId(null);
    },
    [fetcher],
  );

  const handleDelete = useCallback((id: string) => {
    setConfirmDeleteId(id);
  }, []);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if ("success" in fetcher.data && fetcher.data.success) {
        const fetcherAction =
          "action" in fetcher.data ? fetcher.data.action : "";
        if (fetcherAction === "created") {
          shopify.toast.show("Rule created");
          setModalOpen(false);
          resetForm();
        } else if (fetcherAction === "updated") {
          shopify.toast.show("Rule updated");
          setModalOpen(false);
          resetForm();
        } else if (fetcherAction === "deleted") {
          shopify.toast.show("Rule deleted");
        } else if (fetcherAction === "toggled") {
          shopify.toast.show("Rule status updated");
        } else if (fetcherAction === "bulk-deleted") {
          shopify.toast.show("Selected rules deleted");
          clearSelection();
        } else if (fetcherAction === "bulk-activated") {
          shopify.toast.show("Selected rules activated");
          clearSelection();
        } else if (fetcherAction === "bulk-deactivated") {
          shopify.toast.show("Selected rules deactivated");
          clearSelection();
        }
      }
    }
  }, [fetcher.state, fetcher.data, shopify, resetForm, clearSelection]);

  const handleToggle = useCallback(
    (id: string, isActive: boolean) => {
      const fd = new FormData();
      fd.set("intent", "toggle");
      fd.set("id", id);
      fd.set("isActive", String(isActive));
      fetcher.submit(fd, { method: "POST" });
    },
    [fetcher],
  );

  const toggleDay = useCallback((day: string) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }, []);

  const doBulkDelete = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "bulk-delete");
    fd.set("ids", selectedResources.join(","));
    fetcher.submit(fd, { method: "POST" });
    setConfirmBulkDeleteOpen(false);
  }, [selectedResources, fetcher]);

  const handleBulkDelete = useCallback(() => {
    setConfirmBulkDeleteOpen(true);
  }, []);

  const handleBulkToggle = useCallback(
    (active: boolean) => {
      const fd = new FormData();
      fd.set("intent", "bulk-toggle");
      fd.set("ids", selectedResources.join(","));
      fd.set("active", String(active));
      fetcher.submit(fd, { method: "POST" });
    },
    [selectedResources, fetcher],
  );

  // Resource Picker handlers (App Bridge v4)
  const handleSelectProducts = useCallback(async () => {
    const selection = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: selectedProductIds.map((id) => ({
        id: `gid://shopify/Product/${id}`,
      })),
    });
    if (selection) {
      const ids = selection
        .map((p) => p.id.split("/").pop())
        .filter((id): id is string => !!id);
      const names: Record<string, string> = {};
      selection.forEach((p) => {
        const id = p.id.split("/").pop();
        if (id) names[id] = p.title;
      });
      setSelectedProductIds(ids);
      setSelectedProductNames(names);
    }
  }, [shopify, selectedProductIds]);

  const handleSelectCollections = useCallback(async () => {
    const selection = await shopify.resourcePicker({
      type: "collection",
      multiple: true,
      selectionIds: selectedCollectionIds.map((id) => ({
        id: `gid://shopify/Collection/${id}`,
      })),
    });
    if (selection) {
      const ids = selection
        .map((c) => c.id.split("/").pop())
        .filter((id): id is string => !!id);
      const names: Record<string, string> = {};
      selection.forEach((c) => {
        const id = c.id.split("/").pop();
        if (id) names[id] = c.title;
      });
      setSelectedCollectionIds(ids);
      setSelectedCollectionNames(names);
    }
  }, [shopify, selectedCollectionIds]);

  const removeProduct = useCallback((id: string) => {
    setSelectedProductIds((prev) => prev.filter((p) => p !== id));
    setSelectedProductNames((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const removeCollection = useCallback((id: string) => {
    setSelectedCollectionIds((prev) => prev.filter((c) => c !== id));
    setSelectedCollectionNames((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const zoneOptions = [
    { label: "All zones", value: "" },
    ...zones.map((z) => ({ label: z, value: z })),
  ];

  // Helper: display text for target column in table
  const getTargetDisplay = (rule: Rule): string => {
    if (rule.targetType === "products" && rule.productIds) {
      const count = rule.productIds.split(",").filter(Boolean).length;
      return `${count} product${count !== 1 ? "s" : ""}`;
    }
    if (rule.targetType === "collections" && rule.collectionIds) {
      const count = rule.collectionIds.split(",").filter(Boolean).length;
      return `${count} collection${count !== 1 ? "s" : ""}`;
    }
    return "All products";
  };

  // Whether the targeting section is available for this merchant
  const targetingDisabled = !limits.productCollectionRules;
  const targetingChoices = [
    { label: "All products", value: "all" },
    {
      label: targetingDisabled ? "Specific products (Pro+ required)" : "Specific products",
      value: "products",
      disabled: targetingDisabled || !hasProductScope,
    },
    {
      label: targetingDisabled ? "Specific collections (Pro+ required)" : "Specific collections",
      value: "collections",
      disabled: targetingDisabled || !hasProductScope,
    },
  ];

  return (
    <Page
      title="Delivery Rules"
      subtitle="Configure delivery fees, minimums, schedules, and conditions per zone"
      backAction={{ onAction: () => navigate("/app") }}
      primaryAction={
        isFreePlan
          ? undefined
          : {
              content: "Add Rule",
              icon: PlusIcon,
              onAction: openCreate,
            }
      }
    >
      <Box paddingBlockEnd="1600">
      <Layout>
        {isFreePlan && (
          <Layout.Section>
            <Banner
              tone="info"
              title="Delivery rules require a paid plan"
              action={{
                content: "View pricing plans",
                url: "/app/pricing",
              }}
            >
              <Text as="p">
                Upgrade to the Starter plan or higher to create delivery rules
                with custom fees, schedules, and zone conditions.
              </Text>
            </Banner>
          </Layout.Section>
        )}
        {hasFiniteLimit && (
          <Layout.Section>
            <InlineStack align="end">
              <Badge
                tone={
                  (rules as Rule[]).length >= limits.maxDeliveryRules
                    ? "warning"
                    : undefined
                }
              >
                {`${(rules as Rule[]).length}/${limits.maxDeliveryRules} rules used`}
              </Badge>
            </InlineStack>
          </Layout.Section>
        )}
        <Layout.Section>
          <Card padding="0">
            {(rules as Rule[]).length === 0 ? (
              <EmptyState
                heading="No delivery rules yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                action={
                  isFreePlan
                    ? {
                        content: "Upgrade to create rules",
                        onAction: () => navigate("/app/pricing"),
                      }
                    : {
                        content: "Create your first rule",
                        onAction: openCreate,
                      }
                }
              >
                <Text as="p">
                  Delivery rules let you set fees, minimum order amounts,
                  estimated delivery times, and delivery schedules for different
                  zones. Rules are evaluated by priority order.
                </Text>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "rule", plural: "rules" }}
                itemCount={(rules as Rule[]).length}
                selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
                onSelectionChange={handleSelectionChange}
                headings={[
                  { title: "Rule Name" },
                  { title: "Target" },
                  { title: "Zone" },
                  { title: "Delivery Fee" },
                  { title: "Min. Order" },
                  { title: "ETA" },
                  { title: "Days" },
                  { title: "Actions" },
                ]}
                promotedBulkActions={[
                  { content: "Activate", onAction: () => handleBulkToggle(true) },
                  { content: "Deactivate", onAction: () => handleBulkToggle(false) },
                ]}
                bulkActions={[
                  { content: "Delete selected", onAction: handleBulkDelete },
                ]}
              >
                {(rules as Rule[]).map((rule, index) => (
                  <IndexTable.Row
                    id={rule.id}
                    key={rule.id}
                    selected={selectedResources.includes(rule.id)}
                    position={index}
                  >
                    <IndexTable.Cell>
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="bold">{rule.name}</Text>
                        <Badge tone={rule.isActive ? "success" : undefined}>
                          {rule.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge
                        tone={rule.targetType !== "all" ? "info" : undefined}
                      >
                        {getTargetDisplay(rule)}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{rule.zone || "All"}</IndexTable.Cell>
                    <IndexTable.Cell>
                      {rule.deliveryFee != null ? `$${rule.deliveryFee.toFixed(2)}` : "Free"}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {rule.minOrderAmount != null ? `$${rule.minOrderAmount.toFixed(2)}` : "—"}
                    </IndexTable.Cell>
                    <IndexTable.Cell>{rule.estimatedDays || "—"}</IndexTable.Cell>
                    <IndexTable.Cell>{rule.daysOfWeek || "All days"}</IndexTable.Cell>
                    <IndexTable.Cell>
                      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                      <div onClick={(e) => e.stopPropagation()}>
                      <InlineStack gap="200">
                        <Tooltip content={rule.isActive ? "Click to deactivate" : "Click to activate"}>
                          <Button
                            size="slim"
                            variant="tertiary"
                            tone={rule.isActive ? "success" : undefined}
                            onClick={() => handleToggle(rule.id, rule.isActive)}
                            icon={rule.isActive ? ViewIcon : HideIcon}
                            accessibilityLabel={rule.isActive ? "Deactivate rule" : "Activate rule"}
                          />
                        </Tooltip>
                        <Tooltip content="Edit rule">
                          <Button
                            size="slim"
                            variant="tertiary"
                            onClick={() => openEdit(rule)}
                            icon={EditIcon}
                            accessibilityLabel="Edit"
                          />
                        </Tooltip>
                        <Tooltip content="Delete rule">
                          <Button
                            size="slim"
                            variant="tertiary"
                            tone="critical"
                            onClick={() => handleDelete(rule.id)}
                            icon={DeleteIcon}
                            accessibilityLabel="Delete"
                          />
                        </Tooltip>
                      </InlineStack>
                      </div>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>
      </Layout>
      </Box>

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          resetForm();
        }}
        title={editingRule ? "Edit Delivery Rule" : "Create Delivery Rule"}
        primaryAction={{
          content: editingRule ? "Save Changes" : "Create Rule",
          onAction: handleSave,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => {
              setModalOpen(false);
              resetForm();
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {actionError && <Banner tone="critical">{actionError}</Banner>}

            <TextField
              label="Rule Name"
              value={name}
              onChange={setName}
              placeholder="e.g. Manhattan Standard Delivery"
              autoComplete="off"
              helpText="A descriptive name for this delivery rule."
            />

            {/* Product Targeting Section */}
            <Divider />
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h3" variant="headingSm">
                  Product Targeting
                </Text>
                {targetingDisabled && (
                  <Badge tone="warning">Pro+ required</Badge>
                )}
              </InlineStack>

              {!hasProductScope && !targetingDisabled && (
                <Banner
                  tone="warning"
                  title="Additional permission required"
                  action={{
                    content: "Approve permissions",
                    url: "/auth/login",
                  }}
                >
                  <Text as="p">
                    Product and collection-based delivery rules require access
                    to your store&apos;s product data. Click &ldquo;Approve
                    permissions&rdquo; to enable this feature.
                  </Text>
                </Banner>
              )}

              <ChoiceList
                title="Apply this rule to"
                titleHidden
                choices={targetingChoices}
                selected={[targetType]}
                onChange={(value) =>
                  setTargetType(value[0] as "all" | "products" | "collections")
                }
              />

              {targetType === "products" && hasProductScope && !targetingDisabled && (
                <BlockStack gap="200">
                  <Button onClick={handleSelectProducts} variant="secondary">
                    {selectedProductIds.length > 0
                      ? "Change products"
                      : "Select products"}
                  </Button>
                  {selectedProductIds.length > 0 && (
                    <InlineStack gap="200" wrap>
                      {selectedProductIds.map((id) => (
                        <Tag key={id} onRemove={() => removeProduct(id)}>
                          {selectedProductNames[id] || `Product ${id}`}
                        </Tag>
                      ))}
                    </InlineStack>
                  )}
                  {selectedProductIds.length === 0 && (
                    <Text as="p" tone="subdued" variant="bodySm">
                      No products selected. This rule will not match any products
                      until you select at least one.
                    </Text>
                  )}
                </BlockStack>
              )}

              {targetType === "collections" && hasProductScope && !targetingDisabled && (
                <BlockStack gap="200">
                  <Button onClick={handleSelectCollections} variant="secondary">
                    {selectedCollectionIds.length > 0
                      ? "Change collections"
                      : "Select collections"}
                  </Button>
                  {selectedCollectionIds.length > 0 && (
                    <InlineStack gap="200" wrap>
                      {selectedCollectionIds.map((id) => (
                        <Tag key={id} onRemove={() => removeCollection(id)}>
                          {selectedCollectionNames[id] || `Collection ${id}`}
                        </Tag>
                      ))}
                    </InlineStack>
                  )}
                  {selectedCollectionIds.length === 0 && (
                    <Text as="p" tone="subdued" variant="bodySm">
                      No collections selected. This rule will not match any
                      products until you select at least one collection.
                    </Text>
                  )}
                </BlockStack>
              )}
            </BlockStack>

            <Divider />
            <Text as="h3" variant="headingSm">
              Geography
            </Text>

            <InlineGrid columns={2} gap="300">
              <Select
                label="Zone"
                options={zoneOptions}
                value={zone}
                onChange={setZone}
                helpText="Apply this rule to a specific zone, or all zones."
              />
              <TextField
                label="Priority"
                type="number"
                value={priority}
                onChange={setPriority}
                autoComplete="off"
                helpText="Lower number = higher priority."
              />
            </InlineGrid>

            <TextField
              label="Specific Zip Codes (optional)"
              value={zipCodes}
              onChange={setZipCodes}
              placeholder="10001, 10002, 10003"
              autoComplete="off"
              helpText="Comma-separated zip codes. Leave empty to apply to all zip codes in the zone."
            />

            <Divider />
            <Text as="h3" variant="headingSm">
              Pricing
            </Text>

            <InlineGrid columns={2} gap="300">
              <TextField
                label="Delivery Fee ($)"
                type="number"
                value={deliveryFee}
                onChange={setDeliveryFee}
                placeholder="0.00"
                autoComplete="off"
                helpText="Leave empty for free delivery."
              />
              <TextField
                label="Min. Order Amount ($)"
                type="number"
                value={minOrderAmount}
                onChange={setMinOrderAmount}
                placeholder="0.00"
                autoComplete="off"
                helpText="Minimum order to qualify for delivery."
              />
            </InlineGrid>

            <TextField
              label="Free Shipping Above ($)"
              type="number"
              value={freeShippingAbove}
              onChange={setFreeShippingAbove}
              placeholder="e.g. 50.00"
              autoComplete="off"
              helpText="Waive the delivery fee for orders above this amount."
            />

            <Divider />
            <Text as="h3" variant="headingSm">
              Schedule
            </Text>

            <InlineGrid columns={2} gap="300">
              <TextField
                label="Estimated Delivery"
                value={estimatedDays}
                onChange={setEstimatedDays}
                placeholder="e.g. 2-3 days"
                autoComplete="off"
              />
              <TextField
                label="Order Cutoff Time"
                value={cutoffTime}
                onChange={setCutoffTime}
                placeholder="e.g. 14:00"
                autoComplete="off"
                helpText="Orders after this time ship next delivery day."
              />
            </InlineGrid>

            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                Delivery Days
              </Text>
              <InlineStack gap="300" wrap>
                {DAYS_OPTIONS.map((day) => (
                  <Checkbox
                    key={day.value}
                    label={day.label}
                    checked={selectedDays.includes(day.value)}
                    onChange={() => toggleDay(day.value)}
                  />
                ))}
              </InlineStack>
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Single Delete Confirmation Modal */}
      <Modal
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        title="Delete delivery rule?"
        primaryAction={{
          content: "Delete",
          onAction: () => confirmDeleteId && doDelete(confirmDeleteId),
          loading: isDeleteLoading,
          destructive: true,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setConfirmDeleteId(null),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            This will permanently delete this delivery rule. This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>

      {/* Bulk Delete Confirmation Modal */}
      <Modal
        open={confirmBulkDeleteOpen}
        onClose={() => setConfirmBulkDeleteOpen(false)}
        title={`Delete ${selectedResources.length} rule${selectedResources.length !== 1 ? "s" : ""}?`}
        primaryAction={{
          content: "Delete",
          onAction: doBulkDelete,
          loading: isBulkDeleteLoading,
          destructive: true,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setConfirmBulkDeleteOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            This will permanently delete{" "}
            <Text as="span" fontWeight="semibold">
              {selectedResources.length} rule{selectedResources.length !== 1 ? "s" : ""}
            </Text>
            . This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

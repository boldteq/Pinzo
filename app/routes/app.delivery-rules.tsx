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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

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

  return {
    rules,
    zones: zones.map((z) => z.zone).filter(Boolean) as string[],
    subscription,
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

    if (!name) return { error: "Rule name is required." };

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
};

export default function DeliveryRulesPage() {
  const { rules, zones, subscription } = useLoaderData<typeof loader>();
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

  // Form state
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
    setEditingRule(null);
  }, []);

  const openCreate = useCallback(() => {
    resetForm();
    setModalOpen(true);
  }, [resetForm]);

  const openEdit = useCallback((rule: Rule) => {
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
    setModalOpen(true);
  }, []);

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

  const handleDelete = useCallback(
    (id: string) => {
      setConfirmDeleteId(id);
    },
    [],
  );

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

  const toggleDay = useCallback(
    (day: string) => {
      setSelectedDays((prev) =>
        prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
      );
    },
    [],
  );

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

  const zoneOptions = [
    { label: "All zones", value: "" },
    ...zones.map((z) => ({ label: z, value: z })),
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
                onAction: () => navigate("/app/pricing"),
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

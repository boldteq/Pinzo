import { useState, useCallback, useMemo, useEffect } from "react";
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
  Text,
  Button,
  TextField,
  Select,
  Modal,
  DataTable,
  EmptyState,
  Divider,
  Box,
  Tooltip,
  Icon,
  Banner,
  Pagination,
  InlineGrid,
} from "@shopify/polaris";
import {
  SearchIcon,
  DeleteIcon,
  PlusIcon,
  EmailIcon,
} from "@shopify/polaris-icons";

const PAGE_SIZE = 10;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [entries, subscription] = await Promise.all([
    db.waitlistEntry.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
    }),
    getShopSubscription(shop),
  ]);

  const stats = {
    total: entries.length,
    waiting: entries.filter((e) => e.status === "waiting").length,
    accepted: entries.filter((e) => e.status === "accepted").length,
    rejected: entries.filter((e) => e.status === "rejected").length,
    notified: entries.filter((e) => e.status === "notified").length,
    converted: entries.filter((e) => e.status === "converted").length,
    uniqueZips: [...new Set(entries.map((e) => e.zipCode))].length,
  };

  return { entries, stats, subscription };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "add") {
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const zipCode = String(formData.get("zipCode") || "")
      .trim()
      .toUpperCase();
    const note = String(formData.get("note") || "").trim() || null;

    if (!email || !zipCode) return { error: "Email and zip code are required." };

    const subscription = await getShopSubscription(shop);
    const limits = PLAN_LIMITS[subscription.planTier];

    if (limits.maxWaitlist === 0) {
      return { error: "Your current plan does not include waitlist access. Upgrade to Starter or higher." };
    }

    if (limits.maxWaitlist < UNLIMITED) {
      const currentCount = await db.waitlistEntry.count({ where: { shop } });
      if (currentCount >= limits.maxWaitlist) {
        return { error: `You have reached the ${limits.maxWaitlist}-entry waitlist limit on your ${limits.label} plan. Upgrade to Pro for unlimited entries.` };
      }
    }

    try {
      await db.waitlistEntry.create({
        data: { shop, email, zipCode, note },
      });
      return { success: true, action: "added" };
    } catch {
      return { error: "This email is already on the waitlist for this zip code." };
    }
  }

  if (intent === "delete") {
    const id = String(formData.get("id"));
    try {
      const existing = await db.waitlistEntry.findFirst({ where: { id, shop } });
      if (!existing) return { error: "Entry not found." };
      await db.waitlistEntry.delete({ where: { id } });
      return { success: true, action: "deleted" };
    } catch {
      return { error: "Failed to delete entry." };
    }
  }

  if (intent === "update-status") {
    const id = String(formData.get("id"));
    const status = String(formData.get("status"));
    try {
      const existing = await db.waitlistEntry.findFirst({ where: { id, shop } });
      if (!existing) return { error: "Entry not found." };
      await db.waitlistEntry.update({ where: { id }, data: { status } });
      return { success: true, action: "updated" };
    } catch {
      return { error: "Failed to update entry status." };
    }
  }

  if (intent === "bulk-notify") {
    const zipCode = String(formData.get("zipCode") || "")
      .trim()
      .toUpperCase();
    if (!zipCode) return { error: "Zip code is required." };

    const bulkNotifySub = await getShopSubscription(shop);
    if (PLAN_LIMITS[bulkNotifySub.planTier].maxWaitlist < UNLIMITED) {
      return { error: "Bulk notify is only available on Pro or Ultimate plans. Please upgrade." };
    }

    const updated = await db.waitlistEntry.updateMany({
      where: { shop, zipCode, status: "waiting" },
      data: { status: "notified" },
    });

    return {
      success: true,
      action: "bulk-notify",
      count: updated.count,
      zipCode,
    };
  }

  if (intent === "notify-zip") {
    const zipCode = String(formData.get("zipCode") || "").trim().toUpperCase();
    if (!zipCode) return { error: "No ZIP code specified." };

    const notifyZipSub = await getShopSubscription(shop);
    if (PLAN_LIMITS[notifyZipSub.planTier].maxWaitlist < UNLIMITED) {
      return { error: "Bulk notify is only available on Pro or Ultimate plans. Please upgrade." };
    }

    const entries = await db.waitlistEntry.findMany({
      where: { shop, zipCode, status: "waiting" },
      select: { id: true, email: true },
    });

    if (entries.length === 0) {
      return { action: "notify-zip", zipCode, emails: [] as string[], count: 0 };
    }

    await db.waitlistEntry.updateMany({
      where: { shop, zipCode, status: "waiting" },
      data: { status: "notified" },
    });

    const emails = entries.map((e) => e.email);
    return { action: "notify-zip", zipCode, emails, count: emails.length };
  }

  if (intent === "delete-all-notified") {
    const deleted = await db.waitlistEntry.deleteMany({
      where: { shop, status: "notified" },
    });
    return { success: true, action: "deleted-notified", count: deleted.count };
  }

  if (intent === "accept") {
    const id = String(formData.get("id"));
    const entry = await db.waitlistEntry.findUnique({ where: { id } });
    if (!entry || entry.shop !== shop) {
      return { error: "Entry not found." };
    }

    // Add the ZIP code to the allowed list
    await db.zipCode.upsert({
      where: { shop_zipCode: { shop, zipCode: entry.zipCode } },
      create: {
        shop,
        zipCode: entry.zipCode,
        type: "allowed",
        isActive: true,
        label: `Requested by ${entry.name || entry.email}`,
      },
      update: {
        type: "allowed",
        isActive: true,
      },
    });

    // Mark the waitlist entry as accepted
    await db.waitlistEntry.update({
      where: { id },
      data: { status: "accepted" },
    });

    return { success: true, action: "accepted", zipCode: entry.zipCode };
  }

  if (intent === "reject") {
    const id = String(formData.get("id"));
    try {
      const existing = await db.waitlistEntry.findFirst({ where: { id, shop } });
      if (!existing) return { error: "Entry not found." };
      await db.waitlistEntry.update({
        where: { id },
        data: { status: "rejected" },
      });
      return { success: true, action: "rejected" };
    } catch {
      return { error: "Failed to reject entry." };
    }
  }

  return null;
};

type WaitlistEntry = {
  id: string;
  name: string | null;
  email: string;
  zipCode: string;
  note: string | null;
  status: string;
  createdAt: string | Date;
};

export default function WaitlistPage() {
  const { entries, stats, subscription } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();

  const limits = PLAN_LIMITS[subscription.planTier];
  const isFreePlan = limits.maxWaitlist === 0;
  const isStarterPlan = limits.maxWaitlist < UNLIMITED && limits.maxWaitlist > 0;

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [notifyModalOpen, setNotifyModalOpen] = useState(false);
  const [notifyResultModalOpen, setNotifyResultModalOpen] = useState(false);
  const [notifyResult, setNotifyResult] = useState<{
    zipCode: string;
    emails: string[];
    count: number;
  } | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  // Form state
  const [newEmail, setNewEmail] = useState("");
  const [newZipCode, setNewZipCode] = useState("");
  const [newNote, setNewNote] = useState("");
  const [notifyZip, setNotifyZip] = useState("");

  const actionError =
    fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;

  useEffect(() => {
    if (
      fetcher.data &&
      "action" in fetcher.data &&
      fetcher.data.action === "notify-zip"
    ) {
      const data = fetcher.data as {
        action: string;
        zipCode: string;
        emails: string[];
        count: number;
      };
      setNotifyResult({ zipCode: data.zipCode, emails: data.emails, count: data.count });
      setNotifyResultModalOpen(true);
    }
  }, [fetcher.data]);

  const filteredEntries = useMemo(() => {
    let filtered = entries as WaitlistEntry[];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.email.toLowerCase().includes(q) ||
          e.zipCode.toLowerCase().includes(q) ||
          (e.note && e.note.toLowerCase().includes(q)),
      );
    }
    if (statusFilter !== "all") {
      filtered = filtered.filter((e) => e.status === statusFilter);
    }
    return filtered;
  }, [entries, searchQuery, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const paginatedEntries = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredEntries.slice(start, start + PAGE_SIZE);
  }, [filteredEntries, currentPage]);

  const handleSearchChange = useCallback((val: string) => {
    setSearchQuery(val);
    setCurrentPage(1);
  }, []);

  const handleFilterChange = useCallback((val: string) => {
    setStatusFilter(val);
    setCurrentPage(1);
  }, []);

  const handleAdd = useCallback(() => {
    if (!newEmail.trim() || !newZipCode.trim()) return;
    const fd = new FormData();
    fd.set("intent", "add");
    fd.set("email", newEmail);
    fd.set("zipCode", newZipCode);
    fd.set("note", newNote);
    fetcher.submit(fd, { method: "POST" });
  }, [newEmail, newZipCode, newNote, fetcher]);

  const handleDelete = useCallback(
    (id: string) => {
      const fd = new FormData();
      fd.set("intent", "delete");
      fd.set("id", id);
      fetcher.submit(fd, { method: "POST" });
    },
    [fetcher],
  );

  const handleStatusChange = useCallback(
    (id: string, status: string) => {
      const fd = new FormData();
      fd.set("intent", "update-status");
      fd.set("id", id);
      fd.set("status", status);
      fetcher.submit(fd, { method: "POST" });
    },
    [fetcher],
  );

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if ("success" in fetcher.data && fetcher.data.success) {
        const fetcherAction =
          "action" in fetcher.data ? fetcher.data.action : "";
        if (fetcherAction === "added") {
          shopify.toast.show("Added to waitlist");
          setAddModalOpen(false);
          setNewEmail("");
          setNewZipCode("");
          setNewNote("");
        } else if (fetcherAction === "deleted") {
          shopify.toast.show("Entry removed");
        } else if (fetcherAction === "updated") {
          shopify.toast.show("Status updated");
        } else if (fetcherAction === "accepted") {
          shopify.toast.show("ZIP code accepted and added to allowed list");
        } else if (fetcherAction === "rejected") {
          shopify.toast.show("Request rejected");
        } else if (fetcherAction === "deleted-notified") {
          shopify.toast.show("Notified entries cleared");
        }
      }
    }
  }, [fetcher.state, fetcher.data, shopify]);

  const handleBulkNotify = useCallback(() => {
    if (!notifyZip.trim()) return;
    const fd = new FormData();
    fd.set("intent", "notify-zip");
    fd.set("zipCode", notifyZip);
    fetcher.submit(fd, { method: "POST" });
    setNotifyModalOpen(false);
    setNotifyZip("");
  }, [notifyZip, fetcher]);

  const handleCopyEmails = useCallback(() => {
    if (!notifyResult) return;
    navigator.clipboard.writeText(notifyResult.emails.join(", ")).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  }, [notifyResult]);

  const handleDeleteNotified = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "delete-all-notified");
    fetcher.submit(fd, { method: "POST" });
  }, [fetcher]);

  const handleAccept = useCallback(
    (id: string) => {
      const fd = new FormData();
      fd.set("intent", "accept");
      fd.set("id", id);
      fetcher.submit(fd, { method: "POST" });
    },
    [fetcher],
  );

  const handleReject = useCallback(
    (id: string) => {
      const fd = new FormData();
      fd.set("intent", "reject");
      fd.set("id", id);
      fetcher.submit(fd, { method: "POST" });
    },
    [fetcher],
  );

  // Compute per-ZIP waiting counts for the "Notify Waitlist" section
  const zipWaitingCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries as WaitlistEntry[]) {
      if (e.status === "waiting") {
        map.set(e.zipCode, (map.get(e.zipCode) ?? 0) + 1);
      }
    }
    return Array.from(map.entries())
      .map(([zipCode, count]) => ({ zipCode, count }))
      .sort((a, b) => b.count - a.count);
  }, [entries]);

  const handleNotifyZip = useCallback(
    (zipCode: string) => {
      const fd = new FormData();
      fd.set("intent", "notify-zip");
      fd.set("zipCode", zipCode);
      fetcher.submit(fd, { method: "POST" });
    },
    [fetcher],
  );

  if (isFreePlan) {
    return (
      <Page
        title="Customer Waitlist"
        subtitle="Customers waiting for delivery availability in their area"
        backAction={{ onAction: () => navigate("/app") }}
      >
        <Layout>
          <Layout.Section>
            <Banner
              tone="info"
              title="Waitlist requires Starter plan or higher"
              action={{ content: "View pricing plans", url: "/app/pricing" }}
            >
              <Text as="p">
                The customer waitlist feature is not available on the Free plan.
                Upgrade to Starter to collect up to 25 waitlist entries, or upgrade
                to Pro or Ultimate for unlimited entries and bulk notify.
              </Text>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const statusOptions = [
    { label: "Waiting", value: "waiting" },
    { label: "Accepted", value: "accepted" },
    { label: "Rejected", value: "rejected" },
    { label: "Notified", value: "notified" },
    { label: "Converted", value: "converted" },
  ];

  const filterOptions = [
    { label: "All", value: "all" },
    { label: "Waiting", value: "waiting" },
    { label: "Accepted", value: "accepted" },
    { label: "Rejected", value: "rejected" },
    { label: "Notified", value: "notified" },
    { label: "Converted", value: "converted" },
  ];

  const formatDate = (d: string | Date) => {
    const date = new Date(d);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const tableRows = paginatedEntries.map((entry) => [
    <BlockStack gap="050" key={`name-${entry.id}`}>
      <Text as="span" fontWeight="semibold">
        {entry.name || "—"}
      </Text>
      <Text as="span" variant="bodySm" tone="subdued">
        {entry.email}
      </Text>
    </BlockStack>,
    <Text as="span" fontWeight="bold" key={`zip-${entry.id}`}>
      {entry.zipCode}
    </Text>,
    <Box key={`status-${entry.id}`} minWidth="120px">
      <Select
        label="Status"
        labelHidden
        options={statusOptions}
        value={entry.status}
        onChange={(val) => handleStatusChange(entry.id, val)}
      />
    </Box>,
    formatDate(entry.createdAt),
    <InlineStack gap="200" key={`actions-${entry.id}`} wrap={false}>
      {entry.status === "waiting" && (
        <>
          <Tooltip content="Accept — adds ZIP to allowed list">
            <Button
              size="slim"
              tone="success"
              onClick={() => handleAccept(entry.id)}
            >
              Accept
            </Button>
          </Tooltip>
          <Tooltip content="Reject this request">
            <Button
              size="slim"
              tone="critical"
              onClick={() => handleReject(entry.id)}
            >
              Reject
            </Button>
          </Tooltip>
        </>
      )}
      <Tooltip content="Remove from waitlist">
        <Button
          size="slim"
          variant="tertiary"
          tone="critical"
          onClick={() => handleDelete(entry.id)}
          icon={DeleteIcon}
          accessibilityLabel="Delete"
        />
      </Tooltip>
    </InlineStack>,
  ]);

  return (
    <Page
      title="Customer Waitlist"
      subtitle="Customers waiting for delivery availability in their area"
      backAction={{ onAction: () => navigate("/app") }}
      primaryAction={
        isStarterPlan && stats.total >= limits.maxWaitlist
          ? {
              content: "Upgrade to Add More",
              onAction: () => navigate("/app/pricing"),
            }
          : {
              content: "Add Entry",
              icon: PlusIcon,
              onAction: () => setAddModalOpen(true),
            }
      }
      secondaryActions={
        !isStarterPlan
          ? [
              {
                content: "Notify by ZIP",
                icon: EmailIcon,
                onAction: () => setNotifyModalOpen(true),
              },
            ]
          : undefined
      }
    >
      <Box paddingBlockEnd="1600">
      <Layout>
        {/* Stats */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 2, sm: 2, md: 5 }} gap="400">
            <Box
              padding="400"
              background="bg-surface"
              borderWidth="025"
              borderColor="border"
              borderRadius="200"
            >
              <BlockStack gap="100">
                <Text as="p" tone="subdued" variant="bodySm">
                  Total
                </Text>
                <Text as="p" variant="headingXl" fontWeight="bold">
                  {stats.total}
                </Text>
              </BlockStack>
            </Box>
            <Box
              padding="400"
              background="bg-surface-warning"
              borderWidth="025"
              borderColor="border-warning"
              borderRadius="200"
            >
              <BlockStack gap="100">
                <Text as="p" tone="caution" variant="bodySm">
                  Waiting
                </Text>
                <Text as="p" variant="headingXl" fontWeight="bold" tone="caution">
                  {stats.waiting}
                </Text>
              </BlockStack>
            </Box>
            <Box
              padding="400"
              background="bg-surface-info"
              borderWidth="025"
              borderColor="border-info"
              borderRadius="200"
            >
              <BlockStack gap="100">
                <Text as="p" tone="subdued" variant="bodySm">
                  Notified
                </Text>
                <Text as="p" variant="headingXl" fontWeight="bold">
                  {stats.notified}
                </Text>
              </BlockStack>
            </Box>
            <Box
              padding="400"
              background="bg-surface-success"
              borderWidth="025"
              borderColor="border-success"
              borderRadius="200"
            >
              <BlockStack gap="100">
                <Text as="p" tone="success" variant="bodySm">
                  Converted
                </Text>
                <Text as="p" variant="headingXl" fontWeight="bold" tone="success">
                  {stats.converted}
                </Text>
              </BlockStack>
            </Box>
            <Box
              padding="400"
              background="bg-surface"
              borderWidth="025"
              borderColor="border"
              borderRadius="200"
            >
              <BlockStack gap="100">
                <Text as="p" tone="subdued" variant="bodySm">
                  Unique Zips
                </Text>
                <Text as="p" variant="headingXl" fontWeight="bold">
                  {stats.uniqueZips}
                </Text>
              </BlockStack>
            </Box>
          </InlineGrid>
        </Layout.Section>

        {/* Starter plan usage indicator */}
        {isStarterPlan && (
          <Layout.Section>
            <Banner
              tone={stats.total >= limits.maxWaitlist ? "warning" : "info"}
              title={`Waitlist usage: ${stats.total}/${limits.maxWaitlist} entries`}
              action={
                stats.total >= limits.maxWaitlist
                  ? { content: "Upgrade to Pro for unlimited entries", url: "/app/pricing" }
                  : undefined
              }
            >
              <Text as="p">
                {stats.total >= limits.maxWaitlist
                  ? "You have reached your Starter plan waitlist limit. Upgrade to Pro or Ultimate for unlimited entries and bulk notify."
                  : `You are on the Starter plan with a limit of ${limits.maxWaitlist} waitlist entries. Bulk notify is available on Pro and Ultimate plans.`}
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {/* Per-ZIP Notify Section — Pro/Ultimate only */}
        {!isStarterPlan && zipWaitingCounts.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd" fontWeight="semibold">
                    Notify Waiting Customers by ZIP Code
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Select a ZIP code to retrieve all waiting customer emails
                    and mark them as notified in one click.
                  </Text>
                </BlockStack>
                <Divider />
                <BlockStack gap="300">
                  {zipWaitingCounts.map(({ zipCode, count }) => (
                    <InlineStack
                      key={zipCode}
                      align="space-between"
                      blockAlign="center"
                      gap="300"
                      wrap={false}
                    >
                      <InlineStack gap="300" blockAlign="center">
                        <Text as="span" fontWeight="bold">
                          {zipCode}
                        </Text>
                        <Text as="span" tone="subdued" variant="bodySm">
                          {count} customer{count === 1 ? "" : "s"} waiting
                        </Text>
                      </InlineStack>
                      <Button
                        size="slim"
                        icon={EmailIcon}
                        onClick={() => handleNotifyZip(zipCode)}
                        loading={fetcher.state !== "idle"}
                      >
                        {`Notify ${count} Customer${count === 1 ? "" : "s"}`}
                      </Button>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Waitlist Table */}
        <Layout.Section>
          <Card padding="0">
            <Box padding="400">
              <InlineStack
                gap="300"
                align="space-between"
                blockAlign="center"
                wrap
              >
                <InlineStack gap="300" blockAlign="center" wrap>
                  <Box minWidth="260px">
                    <TextField
                      label="Search"
                      labelHidden
                      value={searchQuery}
                      onChange={handleSearchChange}
                      placeholder="Search by email or zip code..."
                      autoComplete="off"
                      prefix={<Icon source={SearchIcon} />}
                      clearButton
                      onClearButtonClick={() => handleSearchChange("")}
                    />
                  </Box>
                  <Box minWidth="120px">
                    <Select
                      label="Status"
                      labelHidden
                      options={filterOptions}
                      value={statusFilter}
                      onChange={handleFilterChange}
                    />
                  </Box>
                </InlineStack>
                <InlineStack gap="200">
                  {stats.notified > 0 && (
                    <Button
                      tone="critical"
                      variant="plain"
                      onClick={handleDeleteNotified}
                    >
                      {`Clear notified (${stats.notified})`}
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    icon={PlusIcon}
                    onClick={() => setAddModalOpen(true)}
                  >
                    Add Entry
                  </Button>
                </InlineStack>
              </InlineStack>
            </Box>
            <Divider />

            {(entries as WaitlistEntry[]).length === 0 ? (
              <EmptyState
                heading="No customers on the waitlist yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                action={{
                  content: "Add first entry",
                  onAction: () => setAddModalOpen(true),
                }}
              >
                <Text as="p">
                  When customers enter a zip code that isn&apos;t in your delivery
                  area, they can join the waitlist. You can also manually add
                  entries here. Enable the waitlist on blocked zip codes in your
                  Widget settings.
                </Text>
              </EmptyState>
            ) : filteredEntries.length === 0 ? (
              <Box padding="600">
                <BlockStack gap="200" inlineAlign="center">
                  <Text as="p" tone="subdued" alignment="center">
                    No entries match your search.
                  </Text>
                  <Button
                    variant="plain"
                    onClick={() => {
                      setSearchQuery("");
                      setStatusFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                </BlockStack>
              </Box>
            ) : (
              <>
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "text",
                    "text",
                    "text",
                  ]}
                  headings={[
                    "Customer",
                    "Zip Code",
                    "Status",
                    "Date",
                    "Actions",
                  ]}
                  rows={tableRows}
                  hoverable
                />
                {totalPages > 1 && (
                  <Box padding="400">
                    <InlineStack align="center" blockAlign="center" gap="300">
                      <Pagination
                        hasPrevious={currentPage > 1}
                        onPrevious={() =>
                          setCurrentPage((p) => Math.max(1, p - 1))
                        }
                        hasNext={currentPage < totalPages}
                        onNext={() =>
                          setCurrentPage((p) => Math.min(totalPages, p + 1))
                        }
                      />
                      <Text as="span" tone="subdued" variant="bodySm">
                        Page {currentPage} of {totalPages} (
                        {filteredEntries.length} results)
                      </Text>
                    </InlineStack>
                  </Box>
                )}
              </>
            )}
          </Card>
        </Layout.Section>
      </Layout>
      </Box>

      {/* Add Entry Modal */}
      <Modal
        open={addModalOpen}
        onClose={() => {
          setAddModalOpen(false);
          setNewEmail("");
          setNewZipCode("");
          setNewNote("");
        }}
        title="Add Waitlist Entry"
        primaryAction={{ content: "Add to Waitlist", onAction: handleAdd }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => {
              setAddModalOpen(false);
              setNewEmail("");
              setNewZipCode("");
              setNewNote("");
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {actionError && <Banner tone="critical">{actionError}</Banner>}
            <TextField
              label="Email"
              type="email"
              value={newEmail}
              onChange={setNewEmail}
              placeholder="customer@example.com"
              autoComplete="off"
            />
            <TextField
              label="Zip Code"
              value={newZipCode}
              onChange={setNewZipCode}
              placeholder="e.g. 33101"
              autoComplete="off"
            />
            <TextField
              label="Note (optional)"
              value={newNote}
              onChange={setNewNote}
              placeholder="Any additional notes..."
              autoComplete="off"
              multiline={2}
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Bulk Notify Modal */}
      <Modal
        open={notifyModalOpen}
        onClose={() => {
          setNotifyModalOpen(false);
          setNotifyZip("");
        }}
        title="Notify Waitlist by Zip Code"
        primaryAction={{
          content: "Notify Waiting Customers",
          onAction: handleBulkNotify,
          disabled: !notifyZip.trim(),
          loading: fetcher.state !== "idle",
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => {
              setNotifyModalOpen(false);
              setNotifyZip("");
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {actionError && <Banner tone="critical">{actionError}</Banner>}
            <Text as="p">
              Enter a zip code to mark all waiting customers for that area as
              &quot;Notified&quot; and retrieve their email addresses. Use this
              when you&apos;ve expanded delivery to a new area and want to
              contact waitlisted customers.
            </Text>
            <TextField
              label="Zip Code"
              value={notifyZip}
              onChange={setNotifyZip}
              placeholder="e.g. 33101"
              autoComplete="off"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Notification Result Modal */}
      <Modal
        open={notifyResultModalOpen}
        onClose={() => {
          setNotifyResultModalOpen(false);
          setCopySuccess(false);
        }}
        title={`Notify Waitlist for ZIP ${notifyResult?.zipCode ?? ""}`}
        primaryAction={{
          content: copySuccess ? "Copied!" : "Copy Emails",
          onAction: handleCopyEmails,
          disabled: !notifyResult || notifyResult.emails.length === 0,
        }}
        secondaryActions={
          notifyResult && notifyResult.emails.length > 0
            ? [
                {
                  content: "Open in Email Client",
                  url: `mailto:${notifyResult.emails.join(",")}?subject=${encodeURIComponent(`Great news! We now deliver to your area (ZIP ${notifyResult.zipCode})`)}&body=${encodeURIComponent(`Hi!\n\nWe wanted to let you know that we now deliver to your ZIP code ${notifyResult.zipCode}.\n\nThank you for your patience!`)}`,
                  external: true,
                },
                {
                  content: "Close",
                  onAction: () => {
                    setNotifyResultModalOpen(false);
                    setCopySuccess(false);
                  },
                },
              ]
            : [
                {
                  content: "Close",
                  onAction: () => {
                    setNotifyResultModalOpen(false);
                    setCopySuccess(false);
                  },
                },
              ]
        }
      >
        <Modal.Section>
          <BlockStack gap="400">
            {notifyResult && notifyResult.count > 0 ? (
              <>
                <Banner tone="success">
                  Updated {notifyResult.count} customer
                  {notifyResult.count === 1 ? "" : "s"} to &quot;Notified&quot;
                  status for ZIP code {notifyResult.zipCode}.
                </Banner>
                <Text as="p">
                  Copy these email addresses and paste them into your preferred
                  email client, or click &quot;Open in Email Client&quot; to
                  launch a pre-filled email.
                </Text>
                <TextField
                  label="Customer Emails"
                  value={notifyResult.emails.join(", ")}
                  onChange={() => {}}
                  multiline={4}
                  autoComplete="off"
                  readOnly
                />
              </>
            ) : (
              <Banner tone="info">
                No customers with &quot;Waiting&quot; status found for ZIP code{" "}
                {notifyResult?.zipCode ?? ""}. They may have already been
                notified.
              </Banner>
            )}
          </BlockStack>
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

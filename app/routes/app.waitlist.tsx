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
import { sendZipAvailableNotification, type EmailOptions } from "../email.server";
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
  IndexTable,
  EmptyState,
  Divider,
  Box,
  Tooltip,
  Icon,
  Banner,
  InlineGrid,
  Checkbox,
  Badge,
  Popover,
  ActionList,
  type IndexTableProps,
} from "@shopify/polaris";
import {
  SearchIcon,
  DeleteIcon,
  PlusIcon,
  EmailIcon,
  CheckSmallIcon,
  EditIcon,
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

  // Fetch email sender settings once for any action that may send emails
  const shopSettings = await db.shopSettings.findUnique({ where: { shop } });
  const emailOpts: EmailOptions = {
    senderName: shopSettings?.emailSenderName,
    shopDisplayName: shopSettings?.shopName,
    replyTo: shopSettings?.emailReplyTo,
  };

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

  if (intent === "notify-zip") {
    const zipCode = String(formData.get("zipCode") || "").trim().toUpperCase();
    if (!zipCode) return { error: "No ZIP code specified." };

    const notifyZipSub = await getShopSubscription(shop);
    if (PLAN_LIMITS[notifyZipSub.planTier].maxWaitlist < UNLIMITED) {
      return { error: "Bulk notify is only available on Pro or Ultimate plans. Please upgrade." };
    }

    const notifyZipEntries = await db.waitlistEntry.findMany({
      where: { shop, zipCode, status: "waiting" },
      select: { id: true, email: true },
    });

    if (notifyZipEntries.length === 0) {
      return { action: "notify-zip", zipCode, emails: [] as string[], count: 0 };
    }

    await db.waitlistEntry.updateMany({
      where: { shop, zipCode, status: "waiting" },
      data: { status: "notified" },
    });

    const emails = notifyZipEntries.map((e) => e.email);
    const shopUrl = `https://${shop}`;
    const emailResults = await Promise.allSettled(
      emails.map((email) =>
        sendZipAvailableNotification(email, zipCode, shop, shopUrl, emailOpts),
      ),
    );
    const emailsSent = emailResults.filter(
      (r) => r.status === "fulfilled" && r.value,
    ).length;

    return { action: "notify-zip", zipCode, emails, count: emails.length, emailsSent };
  }

  if (intent === "notify-selected-zips") {
    const zipCodesRaw = String(formData.get("zipCodes") || "");
    const zipCodes = zipCodesRaw.split(",").map(z => z.trim().toUpperCase()).filter(Boolean);
    if (zipCodes.length === 0) return { error: "No ZIP codes selected." };

    const notifyZipsSub = await getShopSubscription(shop);
    if (PLAN_LIMITS[notifyZipsSub.planTier].maxWaitlist < UNLIMITED) {
      return { error: "Bulk notify is only available on Pro or Ultimate plans. Please upgrade." };
    }

    const waitingEntries = await db.waitlistEntry.findMany({
      where: { shop, status: "waiting", zipCode: { in: zipCodes } },
      select: { id: true, email: true, zipCode: true },
    });

    if (waitingEntries.length === 0) {
      return { action: "notify-selected-zips", emails: [] as string[], count: 0, zipBreakdown: [] as { zipCode: string; count: number }[] };
    }

    await db.waitlistEntry.updateMany({
      where: { shop, status: "waiting", zipCode: { in: zipCodes } },
      data: { status: "notified" },
    });

    const zipMap = new Map<string, number>();
    for (const entry of waitingEntries) {
      zipMap.set(entry.zipCode, (zipMap.get(entry.zipCode) ?? 0) + 1);
    }
    const zipBreakdown = Array.from(zipMap.entries()).map(([zipCode, count]) => ({ zipCode, count }));
    const emails = waitingEntries.map(e => e.email);

    const shopUrl = `https://${shop}`;
    const emailResults = await Promise.allSettled(
      waitingEntries.map((e) =>
        sendZipAvailableNotification(e.email, e.zipCode, shop, shopUrl, emailOpts),
      ),
    );
    const emailsSent = emailResults.filter(
      (r) => r.status === "fulfilled" && r.value,
    ).length;

    return { action: "notify-selected-zips", emails, count: emails.length, zipBreakdown, emailsSent };
  }

  if (intent === "bulk-action") {
    const idsRaw = String(formData.get("ids") || "");
    const ids = idsRaw.split(",").filter(Boolean);
    const bulkType = String(formData.get("bulkType") || "");

    if (ids.length === 0) return { error: "No entries selected." };

    const bulkSub = await getShopSubscription(shop);

    if (bulkType === "notify") {
      if (PLAN_LIMITS[bulkSub.planTier].maxWaitlist < UNLIMITED) {
        return { error: "Bulk notify is only available on Pro or Ultimate plans. Please upgrade." };
      }
      const entriesToNotify = await db.waitlistEntry.findMany({
        where: { id: { in: ids }, shop, status: "waiting" },
        select: { id: true, email: true, zipCode: true },
      });
      if (entriesToNotify.length === 0) {
        return { action: "bulk-action-notify", emails: [] as string[], count: 0, zipBreakdown: [] as { zipCode: string; count: number }[] };
      }
      await db.waitlistEntry.updateMany({
        where: { id: { in: ids }, shop, status: "waiting" },
        data: { status: "notified" },
      });
      const zipMap = new Map<string, number>();
      for (const e of entriesToNotify) {
        zipMap.set(e.zipCode, (zipMap.get(e.zipCode) ?? 0) + 1);
      }
      const zipBreakdown = Array.from(zipMap.entries()).map(([z, c]) => ({ zipCode: z, count: c }));

      const shopUrl = `https://${shop}`;
      const emailResults = await Promise.allSettled(
        entriesToNotify.map((e) =>
          sendZipAvailableNotification(e.email, e.zipCode, shop, shopUrl, emailOpts),
        ),
      );
      const emailsSent = emailResults.filter(
        (r) => r.status === "fulfilled" && r.value,
      ).length;

      return { action: "bulk-action-notify", emails: entriesToNotify.map(e => e.email), count: entriesToNotify.length, zipBreakdown, emailsSent };
    }

    if (bulkType === "accept") {
      const entriesToAccept = await db.waitlistEntry.findMany({
        where: { id: { in: ids }, shop },
        select: { id: true, email: true, name: true, zipCode: true },
      });
      for (const entry of entriesToAccept) {
        await db.zipCode.upsert({
          where: { shop_zipCode: { shop, zipCode: entry.zipCode } },
          create: { shop, zipCode: entry.zipCode, type: "allowed", isActive: true, label: `Requested by ${entry.name || entry.email}` },
          update: { type: "allowed", isActive: true },
        });
      }
      await db.waitlistEntry.updateMany({
        where: { id: { in: ids }, shop },
        data: { status: "accepted" },
      });
      return { success: true, action: "bulk-accepted", count: entriesToAccept.length };
    }

    if (bulkType === "delete") {
      const result = await db.waitlistEntry.deleteMany({
        where: { id: { in: ids }, shop },
      });
      return { success: true, action: "bulk-deleted", count: result.count };
    }

    return { error: "Unknown bulk action type." };
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

    await db.waitlistEntry.update({
      where: { id },
      data: { status: "accepted" },
    });

    return { success: true, action: "accepted", zipCode: entry.zipCode };
  }

  return null;
};

const STATUS_OPTIONS = [
  { content: "Waiting", value: "waiting" },
  { content: "Accepted", value: "accepted" },
  { content: "Notified", value: "notified" },
  { content: "Converted", value: "converted" },
];

const STATUS_TONE: Record<string, "warning" | "success" | "info" | "critical" | undefined> = {
  waiting: "warning",
  accepted: "success",
  notified: "info",
  converted: "success",
  rejected: "critical",
};

function StatusAction({ id, status, onChangeStatus }: { id: string; status: string; onChangeStatus: (id: string, val: string) => void }) {
  const [popoverActive, setPopoverActive] = useState(false);

  const activator = (
    <Tooltip content="Change status">
      <Button
        size="slim"
        variant="tertiary"
        icon={EditIcon}
        onClick={() => setPopoverActive((v) => !v)}
        accessibilityLabel="Change status"
      />
    </Tooltip>
  );

  return (
    <Popover
      active={popoverActive}
      activator={activator}
      onClose={() => setPopoverActive(false)}
      preferredAlignment="left"
    >
      <ActionList
        items={STATUS_OPTIONS.filter((o) => o.value !== status).map((o) => ({
          content: o.content,
          onAction: () => {
            onChangeStatus(id, o.value);
            setPopoverActive(false);
          },
        }))}
      />
    </Popover>
  );
}

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
    emailsSent?: number;
  } | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  // ZIP checkbox selection
  const [selectedZips, setSelectedZips] = useState<Set<string>>(new Set());

  // IndexTable row selection
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  // Confirmation modals for destructive actions
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearNotifiedOpen, setConfirmClearNotifiedOpen] = useState(false);
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState(false);

  // Form state
  const [newEmail, setNewEmail] = useState("");
  const [newZipCode, setNewZipCode] = useState("");
  const [newNote, setNewNote] = useState("");

  const actionError =
    fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;

  const isDeleteLoading =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "delete";
  const isBulkDeleteLoading =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "bulk-action" &&
    fetcher.formData?.get("bulkType") === "delete";
  const isClearNotifiedLoading =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "delete-all-notified";

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

  // Handle notify results (zip, selected-zips, bulk-action-notify)
  useEffect(() => {
    if (
      fetcher.data &&
      "action" in fetcher.data &&
      (fetcher.data.action === "notify-zip" || fetcher.data.action === "notify-selected-zips" || fetcher.data.action === "bulk-action-notify")
    ) {
      const data = fetcher.data as {
        action: string;
        zipCode?: string;
        emails: string[];
        count: number;
        emailsSent?: number;
        zipBreakdown?: { zipCode: string; count: number }[];
      };
      if (data.action === "notify-zip") {
        setNotifyResult({ zipCode: data.zipCode!, emails: data.emails, count: data.count, emailsSent: data.emailsSent });
      } else {
        setNotifyResult({
          zipCode: data.zipBreakdown?.map(z => z.zipCode).join(", ") ?? "",
          emails: data.emails,
          count: data.count,
          emailsSent: data.emailsSent,
        });
      }
      setNotifyResultModalOpen(true);
      setSelectedZips(new Set());
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
        } else if (fetcherAction === "deleted-notified") {
          shopify.toast.show("Notified entries cleared");
        } else if (fetcherAction === "bulk-accepted") {
          const count = "count" in fetcher.data ? fetcher.data.count : 0;
          shopify.toast.show(`${count} entries accepted`);
        } else if (fetcherAction === "bulk-deleted") {
          const count = "count" in fetcher.data ? fetcher.data.count : 0;
          shopify.toast.show(`${count} entries deleted`);
        }
      }
    }
  }, [fetcher.state, fetcher.data, shopify]);

  const handleCopyEmails = useCallback(() => {
    if (!notifyResult) return;
    navigator.clipboard.writeText(notifyResult.emails.join(", ")).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  }, [notifyResult]);

  const doClearNotified = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "delete-all-notified");
    fetcher.submit(fd, { method: "POST" });
    setConfirmClearNotifiedOpen(false);
  }, [fetcher]);

  const handleDeleteNotified = useCallback(() => {
    setConfirmClearNotifiedOpen(true);
  }, []);

  const handleAccept = useCallback(
    (id: string) => {
      const fd = new FormData();
      fd.set("intent", "accept");
      fd.set("id", id);
      fetcher.submit(fd, { method: "POST" });
    },
    [fetcher],
  );

  const handleNotifyZip = useCallback(
    (zipCode: string) => {
      const fd = new FormData();
      fd.set("intent", "notify-zip");
      fd.set("zipCode", zipCode);
      fetcher.submit(fd, { method: "POST" });
    },
    [fetcher],
  );

  // ZIP checkbox handlers
  const handleToggleZip = useCallback((zipCode: string) => {
    setSelectedZips(prev => {
      const next = new Set(prev);
      if (next.has(zipCode)) next.delete(zipCode);
      else next.add(zipCode);
      return next;
    });
  }, []);

  const handleSelectAllZips = useCallback((checked: boolean) => {
    if (checked) {
      setSelectedZips(new Set(zipWaitingCounts.map(z => z.zipCode)));
    } else {
      setSelectedZips(new Set());
    }
  }, [zipWaitingCounts]);

  const selectedZipCustomerCount = useMemo(() => {
    let count = 0;
    for (const { zipCode, count: c } of zipWaitingCounts) {
      if (selectedZips.has(zipCode)) count += c;
    }
    return count;
  }, [selectedZips, zipWaitingCounts]);

  const handleNotifySelectedZips = useCallback(() => {
    if (selectedZips.size === 0) return;
    const fd = new FormData();
    fd.set("intent", "notify-selected-zips");
    fd.set("zipCodes", Array.from(selectedZips).join(","));
    fetcher.submit(fd, { method: "POST" });
    setNotifyModalOpen(false);
  }, [selectedZips, fetcher]);

  // IndexTable selection handlers
  const handleSelectionChange = useCallback<NonNullable<IndexTableProps["onSelectionChange"]>>(
    (selectionType, isSelecting, selection) => {
      if (selectionType === "all") {
        setSelectedEntryIds(isSelecting ? filteredEntries.map((e: WaitlistEntry) => e.id) : []);
      } else if (selectionType === "page") {
        setSelectedEntryIds(isSelecting ? paginatedEntries.map((e: WaitlistEntry) => e.id) : []);
      } else if (typeof selection === "string") {
        setSelectedEntryIds(prev =>
          isSelecting ? [...prev, selection] : prev.filter(id => id !== selection)
        );
      }
    },
    [filteredEntries, paginatedEntries],
  );

  const doBulkDelete = useCallback(() => {
    if (selectedEntryIds.length === 0) return;
    const fd = new FormData();
    fd.set("intent", "bulk-action");
    fd.set("ids", selectedEntryIds.join(","));
    fd.set("bulkType", "delete");
    fetcher.submit(fd, { method: "POST" });
    setSelectedEntryIds([]);
    setConfirmBulkDeleteOpen(false);
  }, [selectedEntryIds, fetcher]);

  const handleBulkAction = useCallback(
    (bulkType: string) => {
      if (selectedEntryIds.length === 0) return;
      if (bulkType === "delete") {
        setConfirmBulkDeleteOpen(true);
        return;
      }
      const fd = new FormData();
      fd.set("intent", "bulk-action");
      fd.set("ids", selectedEntryIds.join(","));
      fd.set("bulkType", bulkType);
      fetcher.submit(fd, { method: "POST" });
      setSelectedEntryIds([]);
    },
    [selectedEntryIds, fetcher],
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
              action={{ content: "View pricing plans", onAction: () => navigate("/app/pricing") }}
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

  const filterOptions = [
    { label: "All", value: "all" },
    { label: "Waiting", value: "waiting" },
    { label: "Accepted", value: "accepted" },
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

  const bulkActions = [
    {
      content: "Accept Selected",
      onAction: () => handleBulkAction("accept"),
    },
    {
      content: "Delete Selected",
      onAction: () => handleBulkAction("delete"),
      destructive: true,
    },
  ];

  const promotedBulkActions = [
    {
      content: "Notify Selected",
      onAction: () => handleBulkAction("notify"),
    },
  ];

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
                  ? { content: "Upgrade to Pro for unlimited entries", onAction: () => navigate("/app/pricing") }
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

        {/* Per-ZIP Notify Section with checkboxes — Pro/Ultimate only */}
        {!isStarterPlan && zipWaitingCounts.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="start" wrap={false}>
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd" fontWeight="semibold">
                      Notify Waiting Customers by ZIP Code
                    </Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      Select individual ZIP codes below, or notify everyone at once.
                    </Text>
                  </BlockStack>
                  <Button
                    variant="primary"
                    icon={EmailIcon}
                    onClick={() => {
                      handleSelectAllZips(true);
                      setNotifyModalOpen(true);
                    }}
                    loading={fetcher.state !== "idle"}
                  >
                    {`Notify All (${stats.waiting})`}
                  </Button>
                </InlineStack>
                <Divider />
                <BlockStack gap="0">
                  {/* Select All row */}
                  <Box padding="200" paddingInlineStart="0">
                    <InlineStack gap="300" blockAlign="center">
                      <Checkbox
                        label=""
                        labelHidden
                        checked={selectedZips.size === zipWaitingCounts.length && zipWaitingCounts.length > 0}
                        onChange={handleSelectAllZips}
                      />
                      <Text as="span" fontWeight="semibold" variant="bodySm">
                        {selectedZips.size === zipWaitingCounts.length && zipWaitingCounts.length > 0
                          ? `All ${zipWaitingCounts.length} ZIP codes selected (${stats.waiting} customers)`
                          : `Select all ${zipWaitingCounts.length} ZIP codes`}
                      </Text>
                    </InlineStack>
                  </Box>
                  <Divider />
                  {/* Individual ZIP rows */}
                  {zipWaitingCounts.map(({ zipCode, count }) => (
                    <Box key={zipCode} padding="200" paddingInlineStart="0">
                      <InlineStack
                        align="space-between"
                        blockAlign="center"
                        gap="300"
                        wrap={false}
                      >
                        <InlineStack gap="300" blockAlign="center">
                          <Checkbox
                            label=""
                            labelHidden
                            checked={selectedZips.has(zipCode)}
                            onChange={() => handleToggleZip(zipCode)}
                          />
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
                          {`Notify ${count}`}
                        </Button>
                      </InlineStack>
                    </Box>
                  ))}
                </BlockStack>
                {/* Action button — shown when ZIPs are selected */}
                {selectedZips.size > 0 && (
                  <>
                    <Divider />
                    <InlineStack align="end">
                      <Button
                        variant="primary"
                        icon={EmailIcon}
                        onClick={() => setNotifyModalOpen(true)}
                        loading={fetcher.state !== "idle"}
                      >
                        {`Notify ${selectedZipCustomerCount} Customer${selectedZipCustomerCount === 1 ? "" : "s"} in ${selectedZips.size} ZIP Code${selectedZips.size === 1 ? "" : "s"}`}
                      </Button>
                    </InlineStack>
                  </>
                )}
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
              <IndexTable
                itemCount={filteredEntries.length}
                selectedItemsCount={selectedEntryIds.length}
                onSelectionChange={handleSelectionChange}
                headings={[
                  { title: "Customer" },
                  { title: "ZIP Code" },
                  { title: "Status" },
                  { title: "Date" },
                  { title: "Actions" },
                ]}
                bulkActions={bulkActions}
                promotedBulkActions={promotedBulkActions}
                pagination={totalPages > 1 ? {
                  hasPrevious: currentPage > 1,
                  onPrevious: () => setCurrentPage(p => Math.max(1, p - 1)),
                  hasNext: currentPage < totalPages,
                  onNext: () => setCurrentPage(p => Math.min(totalPages, p + 1)),
                  label: `Page ${currentPage} of ${totalPages} (${filteredEntries.length} results)`,
                } : undefined}
              >
                {paginatedEntries.map((entry, index) => (
                  <IndexTable.Row
                    key={entry.id}
                    id={entry.id}
                    position={index}
                    selected={selectedEntryIds.includes(entry.id)}
                  >
                    <IndexTable.Cell>
                      <BlockStack gap="050">
                        <Text as="span" fontWeight="semibold">
                          {entry.name || "—"}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {entry.email}
                        </Text>
                      </BlockStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" fontWeight="bold">
                        {entry.zipCode}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge
                        tone={STATUS_TONE[entry.status]}
                      >
                        {entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {formatDate(entry.createdAt)}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="200" wrap={false} align="end">
                        <Box minWidth="28px">
                          {entry.status === "waiting" && (
                            <Tooltip content="Accept — adds ZIP to allowed list">
                              <Button
                                size="slim"
                                variant="tertiary"
                                tone="success"
                                onClick={() => handleAccept(entry.id)}
                                icon={CheckSmallIcon}
                                accessibilityLabel="Accept"
                              />
                            </Tooltip>
                          )}
                        </Box>
                        <StatusAction
                          id={entry.id}
                          status={entry.status}
                          onChangeStatus={handleStatusChange}
                        />
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

      {/* Confirm Notify Selected ZIP Codes Modal */}
      <Modal
        open={notifyModalOpen}
        onClose={() => setNotifyModalOpen(false)}
        title="Confirm Notify Selected ZIP Codes"
        primaryAction={{
          content: `Notify ${selectedZipCustomerCount} Customer${selectedZipCustomerCount === 1 ? "" : "s"}`,
          onAction: handleNotifySelectedZips,
          loading: fetcher.state !== "idle",
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setNotifyModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Banner tone="warning">
              This will mark {selectedZipCustomerCount} waiting customer{selectedZipCustomerCount === 1 ? "" : "s"} across {selectedZips.size} ZIP code{selectedZips.size === 1 ? "" : "s"} as notified. This action cannot be undone.
            </Banner>
            <Text as="p">
              After confirming, notification emails will be sent automatically to all waiting customers in the selected ZIP codes.
            </Text>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">Selected ZIP Codes:</Text>
              {zipWaitingCounts
                .filter(z => selectedZips.has(z.zipCode))
                .map(({ zipCode, count }) => (
                  <InlineStack key={zipCode} gap="200">
                    <Text as="span" fontWeight="bold">{zipCode}</Text>
                    <Text as="span" tone="subdued">{count} customer{count === 1 ? "" : "s"}</Text>
                  </InlineStack>
                ))}
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Single Delete Confirmation Modal */}
      <Modal
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        title="Remove waitlist entry?"
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
            This will permanently remove this customer from the waitlist. This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>

      {/* Clear Notified Confirmation Modal */}
      <Modal
        open={confirmClearNotifiedOpen}
        onClose={() => setConfirmClearNotifiedOpen(false)}
        title={`Clear ${stats.notified} notified entr${stats.notified === 1 ? "y" : "ies"}?`}
        primaryAction={{
          content: "Clear All",
          onAction: doClearNotified,
          loading: isClearNotifiedLoading,
          destructive: true,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setConfirmClearNotifiedOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            This will permanently delete all <Text as="span" fontWeight="semibold">{stats.notified}</Text> notified waitlist entr{stats.notified === 1 ? "y" : "ies"}. This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>

      {/* Bulk Delete Confirmation Modal */}
      <Modal
        open={confirmBulkDeleteOpen}
        onClose={() => setConfirmBulkDeleteOpen(false)}
        title={`Delete ${selectedEntryIds.length} entr${selectedEntryIds.length === 1 ? "y" : "ies"}?`}
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
              {selectedEntryIds.length} waitlist entr{selectedEntryIds.length === 1 ? "y" : "ies"}
            </Text>
            . This action cannot be undone.
          </Text>
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
                {notifyResult.emailsSent != null && notifyResult.emailsSent > 0 ? (
                  <Banner tone="success">
                    Emails sent to {notifyResult.emailsSent} of{" "}
                    {notifyResult.count} customer
                    {notifyResult.count === 1 ? "" : "s"} for ZIP code{" "}
                    {notifyResult.zipCode}.
                  </Banner>
                ) : notifyResult.emailsSent === 0 ? (
                  <Banner tone="warning">
                    Updated {notifyResult.count} customer
                    {notifyResult.count === 1 ? "" : "s"} to &quot;Notified&quot;
                    status, but emails could not be sent. You can copy the
                    addresses below and contact them manually.
                  </Banner>
                ) : (
                  <Banner tone="success">
                    Updated {notifyResult.count} customer
                    {notifyResult.count === 1 ? "" : "s"} to &quot;Notified&quot;
                    status for ZIP code {notifyResult.zipCode}.
                  </Banner>
                )}
                <Text as="p">
                  You can also copy these email addresses or click &quot;Open in
                  Email Client&quot; as a backup.
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

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
  EmptyState,
  Divider,
  Box,
  Badge,
  Tabs,
  InlineGrid,
  Banner,
} from "@shopify/polaris";
import { PlusIcon, DeleteIcon, ChevronUpIcon } from "@shopify/polaris-icons";

const PAGE_SIZE = 10;
const ADMIN_SHOP = "zipcodechecker.myshopify.com";
const MAX_REQUESTS_PER_SHOP = 20;
const MAX_DESCRIPTION_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FeatureRequestRecord = {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  shop: string;
  votesCount: number;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type VoteResult = {
  success: true;
  intent: "vote";
  featureId: string;
  newCount: number;
  voted: boolean;
};
type SubmitResult = { success: true; intent: "submit" };
type DeleteResult = { success: true; intent: "delete" };
type StatusResult = { success: true; intent: "update-status" };
type ErrorResult = { error: string };

type ActionResult =
  | VoteResult
  | SubmitResult
  | DeleteResult
  | StatusResult
  | ErrorResult;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = new Set([
  "General",
  "UI & Design",
  "Data & Export",
  "API & Integration",
  "Performance",
  "Billing",
]);

const VALID_STATUSES = new Set([
  "under_review",
  "planned",
  "in_progress",
  "done",
  "shipped",
]);

const STATUS_LABELS: Record<string, string> = {
  under_review: "Under Review",
  planned: "Planned",
  in_progress: "In Progress",
  done: "Done",
  shipped: "Shipped",
};

type BadgeTone =
  | "attention"
  | "info"
  | "warning"
  | "success"
  | "critical"
  | undefined;

const STATUS_TONES: Record<string, BadgeTone> = {
  under_review: "attention",
  planned: "info",
  in_progress: "warning",
  done: "success",
  shipped: "success",
};

const CATEGORY_OPTIONS = [
  { label: "General", value: "General" },
  { label: "UI & Design", value: "UI & Design" },
  { label: "Data & Export", value: "Data & Export" },
  { label: "API & Integration", value: "API & Integration" },
  { label: "Performance", value: "Performance" },
  { label: "Billing", value: "Billing" },
];

const STATUS_OPTIONS = [
  { label: "Under Review", value: "under_review" },
  { label: "Planned", value: "planned" },
  { label: "In Progress", value: "in_progress" },
  { label: "Done", value: "done" },
  { label: "Shipped", value: "shipped" },
];

const TAB_FILTERS = [
  "all",
  "under_review",
  "planned",
  "in_progress",
  "done",
] as const;
type TabFilter = (typeof TAB_FILTERS)[number];

const SORT_OPTIONS = [
  { label: "Most Voted", value: "votes" },
  { label: "Newest", value: "newest" },
  { label: "Oldest", value: "oldest" },
];

function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd() + "\u2026";
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [features, myVotes] = await Promise.all([
    db.featureRequest.findMany({
      orderBy: { votesCount: "desc" },
      take: 500,
    }),
    db.featureVote.findMany({
      where: { shop },
      select: { featureRequestId: true },
    }),
  ]);

  const votedIds = myVotes.map((v) => v.featureRequestId);

  const stats = {
    total: features.length,
    under_review: features.filter((f) => f.status === "under_review").length,
    planned: features.filter((f) => f.status === "planned").length,
    in_progress: features.filter((f) => f.status === "in_progress").length,
    done: features.filter(
      (f) => f.status === "done" || f.status === "shipped",
    ).length,
  };

  const isAdmin = shop === ADMIN_SHOP;

  return { features, votedIds, shop, stats, isAdmin };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const isAdmin = shop === ADMIN_SHOP;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  try {
    switch (intent) {
      case "submit": {
        const title = String(formData.get("title") ?? "").trim();
        const description = String(formData.get("description") ?? "").trim();
        const rawCategory = String(formData.get("category") ?? "General").trim();
        const category = VALID_CATEGORIES.has(rawCategory) ? rawCategory : "General";

        if (!title || !description) {
          return { error: "Title and description are required." };
        }
        if (title.length > 150) {
          return { error: "Title must be 150 characters or fewer." };
        }
        if (description.length > MAX_DESCRIPTION_LENGTH) {
          return { error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.` };
        }

        // Per-shop submission limit
        const existingCount = await db.featureRequest.count({ where: { shop } });
        if (existingCount >= MAX_REQUESTS_PER_SHOP) {
          return { error: `You can submit up to ${MAX_REQUESTS_PER_SHOP} feature requests. Delete an existing one to submit a new one.` };
        }

        await db.featureRequest.create({
          data: { title, description, category, shop },
        });

        return { success: true, intent: "submit" };
      }

      case "vote": {
        const featureId = String(formData.get("featureId") ?? "").trim();
        if (!featureId) return { error: "Feature ID is required." };

        const feature = await db.featureRequest.findUnique({
          where: { id: featureId },
        });
        if (!feature) return { error: "Feature request not found." };

        const existing = await db.featureVote.findUnique({
          where: {
            featureRequestId_shop: { featureRequestId: featureId, shop },
          },
        });

        let voted: boolean;

        if (existing) {
          await db.featureVote.delete({ where: { id: existing.id } });
          // Atomic decrement
          const updated = await db.featureRequest.update({
            where: { id: featureId },
            data: { votesCount: { decrement: 1 } },
          });
          // Ensure count doesn't go below 0
          if (updated.votesCount < 0) {
            await db.featureRequest.update({
              where: { id: featureId },
              data: { votesCount: 0 },
            });
          }
          voted = false;
          const finalCount = Math.max(0, updated.votesCount);
          return { success: true, intent: "vote", featureId, newCount: finalCount, voted };
        } else {
          await db.featureVote.create({
            data: { featureRequestId: featureId, shop },
          });
          // Atomic increment
          const updated = await db.featureRequest.update({
            where: { id: featureId },
            data: { votesCount: { increment: 1 } },
          });
          voted = true;
          return { success: true, intent: "vote", featureId, newCount: updated.votesCount, voted };
        }
      }

      case "delete": {
        const deleteId = String(formData.get("id") ?? "").trim();
        if (!deleteId) return { error: "Feature ID is required." };

        const toDelete = await db.featureRequest.findUnique({
          where: { id: deleteId },
        });
        if (!toDelete) return { error: "Feature request not found." };

        // Admin can delete any, regular users only their own
        if (!isAdmin && toDelete.shop !== shop) {
          return { error: "You can only delete your own feature requests." };
        }

        await db.featureRequest.delete({ where: { id: deleteId } });
        return { success: true, intent: "delete" };
      }

      case "update-status": {
        if (!isAdmin) {
          return { error: "Only the app admin can change request statuses." };
        }

        const statusId = String(formData.get("id") ?? "").trim();
        const newStatus = String(formData.get("status") ?? "").trim();

        if (!statusId) return { error: "Feature ID is required." };
        if (!VALID_STATUSES.has(newStatus)) {
          return { error: "Invalid status value." };
        }

        const toUpdate = await db.featureRequest.findUnique({
          where: { id: statusId },
        });
        if (!toUpdate) return { error: "Feature request not found." };

        await db.featureRequest.update({
          where: { id: statusId },
          data: { status: newStatus },
        });

        return { success: true, intent: "update-status" };
      }

      default:
        return { error: "Unknown action." };
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred.";
    return { error: message };
  }
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FeatureRequestsPage() {
  const {
    features: rawFeatures,
    votedIds: initialVotedIds,
    shop,
    stats,
    isAdmin,
  } = useLoaderData<typeof loader>();

  // Separate fetchers for independent actions (Fix #6)
  const voteFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();
  const submitFetcher = useFetcher<typeof action>();
  const statusFetcher = useFetcher<typeof action>();

  const shopify = useAppBridge();
  const navigate = useNavigate();

  // ------------------------------------------------------------------
  // Local state — optimistic votes
  // ------------------------------------------------------------------
  const [optimisticVotes, setOptimisticVotes] = useState<
    Map<string, { count: number; voted: boolean }>
  >(() => new Map());
  const [votedIds, setVotedIds] = useState<Set<string>>(
    () => new Set(initialVotedIds),
  );

  // Per-card loading indicators
  const [pendingVoteId, setPendingVoteId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // ------------------------------------------------------------------
  // UI state
  // ------------------------------------------------------------------
  const [selectedTab, setSelectedTab] = useState(0);
  const [sortValue, setSortValue] = useState("votes");
  const [currentPage, setCurrentPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [modalError, setModalError] = useState<string | null>(null);

  // Form state
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newCategory, setNewCategory] = useState("General");

  // ------------------------------------------------------------------
  // Resolve optimistic state into features list
  // ------------------------------------------------------------------
  const features = useMemo<FeatureRequestRecord[]>(() => {
    return (rawFeatures as FeatureRequestRecord[]).map((f) => {
      const opt = optimisticVotes.get(f.id);
      if (opt) return { ...f, votesCount: opt.count };
      return f;
    });
  }, [rawFeatures, optimisticVotes]);

  // ------------------------------------------------------------------
  // Handle vote fetcher responses
  // ------------------------------------------------------------------
  useEffect(() => {
    if (voteFetcher.state !== "idle" || !voteFetcher.data) return;
    const data = voteFetcher.data;

    if ("error" in data) {
      shopify.toast.show(data.error, { isError: true });
      setPendingVoteId(null);
      return;
    }

    if ("success" in data && data.success && data.intent === "vote") {
      const voteData = data as VoteResult;
      setOptimisticVotes((prev) => {
        const next = new Map(prev);
        next.set(voteData.featureId, {
          count: voteData.newCount,
          voted: voteData.voted,
        });
        return next;
      });
      setVotedIds((prev) => {
        const next = new Set(prev);
        if (voteData.voted) next.add(voteData.featureId);
        else next.delete(voteData.featureId);
        return next;
      });
      setPendingVoteId(null);
    }
  }, [voteFetcher.state, voteFetcher.data, shopify]);

  // ------------------------------------------------------------------
  // Handle delete fetcher responses
  // ------------------------------------------------------------------
  useEffect(() => {
    if (deleteFetcher.state !== "idle" || !deleteFetcher.data) return;
    const data = deleteFetcher.data;

    if ("error" in data) {
      shopify.toast.show(data.error, { isError: true });
      setPendingDeleteId(null);
      return;
    }

    if ("success" in data && data.success && data.intent === "delete") {
      shopify.toast.show("Feature request deleted.");
      setPendingDeleteId(null);
    }
  }, [deleteFetcher.state, deleteFetcher.data, shopify]);

  // ------------------------------------------------------------------
  // Handle submit fetcher responses
  // ------------------------------------------------------------------
  useEffect(() => {
    if (submitFetcher.state !== "idle" || !submitFetcher.data) return;
    const data = submitFetcher.data;

    if ("error" in data) {
      setModalError(data.error);
      return;
    }

    if ("success" in data && data.success && data.intent === "submit") {
      shopify.toast.show("Feature request submitted! Thank you.");
      setModalOpen(false);
      setNewTitle("");
      setNewDescription("");
      setNewCategory("General");
      setModalError(null);
    }
  }, [submitFetcher.state, submitFetcher.data, shopify]);

  // ------------------------------------------------------------------
  // Handle status fetcher responses
  // ------------------------------------------------------------------
  useEffect(() => {
    if (statusFetcher.state !== "idle" || !statusFetcher.data) return;
    const data = statusFetcher.data;

    if ("error" in data) {
      shopify.toast.show(data.error, { isError: true });
      return;
    }

    if ("success" in data && data.success && data.intent === "update-status") {
      shopify.toast.show("Status updated.");
    }
  }, [statusFetcher.state, statusFetcher.data, shopify]);

  // ------------------------------------------------------------------
  // Filter + sort
  // ------------------------------------------------------------------
  const tabFilter: TabFilter = TAB_FILTERS[selectedTab] ?? "all";

  const filteredFeatures = useMemo(() => {
    let list = features;

    if (tabFilter !== "all") {
      if (tabFilter === "done") {
        list = list.filter(
          (f) => f.status === "done" || f.status === "shipped",
        );
      } else {
        list = list.filter((f) => f.status === tabFilter);
      }
    }

    return [...list].sort((a, b) => {
      if (sortValue === "votes") return b.votesCount - a.votesCount;
      if (sortValue === "newest")
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      if (sortValue === "oldest")
        return (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      return 0;
    });
  }, [features, tabFilter, sortValue]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredFeatures.length / PAGE_SIZE),
  );
  const paginatedFeatures = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredFeatures.slice(start, start + PAGE_SIZE);
  }, [filteredFeatures, currentPage]);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------
  const handleTabChange = useCallback((tabIndex: number) => {
    setSelectedTab(tabIndex);
    setCurrentPage(1);
  }, []);

  const handleSortChange = useCallback((val: string) => {
    setSortValue(val);
    setCurrentPage(1);
  }, []);

  const handleVote = useCallback(
    (featureId: string) => {
      const feature = features.find((f) => f.id === featureId);
      if (!feature) return;

      const currentlyVoted = votedIds.has(featureId);
      const currentCount =
        optimisticVotes.get(featureId)?.count ?? feature.votesCount;

      // Optimistic update
      setOptimisticVotes((prev) => {
        const next = new Map(prev);
        next.set(featureId, {
          count: currentlyVoted
            ? Math.max(0, currentCount - 1)
            : currentCount + 1,
          voted: !currentlyVoted,
        });
        return next;
      });
      setVotedIds((prev) => {
        const next = new Set(prev);
        if (currentlyVoted) next.delete(featureId);
        else next.add(featureId);
        return next;
      });

      setPendingVoteId(featureId);

      const fd = new FormData();
      fd.set("intent", "vote");
      fd.set("featureId", featureId);
      voteFetcher.submit(fd, { method: "POST" });
    },
    [features, votedIds, optimisticVotes, voteFetcher],
  );

  const handleDelete = useCallback(
    (id: string) => {
      setPendingDeleteId(id);

      const fd = new FormData();
      fd.set("intent", "delete");
      fd.set("id", id);
      deleteFetcher.submit(fd, { method: "POST" });
    },
    [deleteFetcher],
  );

  const handleSubmitFeature = useCallback(() => {
    if (!newTitle.trim() || !newDescription.trim()) {
      setModalError("Title and description are required.");
      return;
    }
    if (newDescription.trim().length > MAX_DESCRIPTION_LENGTH) {
      setModalError(`Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`);
      return;
    }
    setModalError(null);

    const fd = new FormData();
    fd.set("intent", "submit");
    fd.set("title", newTitle.trim());
    fd.set("description", newDescription.trim());
    fd.set("category", newCategory);
    submitFetcher.submit(fd, { method: "POST" });
  }, [newTitle, newDescription, newCategory, submitFetcher]);

  const handleStatusChange = useCallback(
    (id: string, newStatus: string) => {
      const fd = new FormData();
      fd.set("intent", "update-status");
      fd.set("id", id);
      fd.set("status", newStatus);
      statusFetcher.submit(fd, { method: "POST" });
    },
    [statusFetcher],
  );

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleCloseModal = useCallback(() => {
    setModalOpen(false);
    setNewTitle("");
    setNewDescription("");
    setNewCategory("General");
    setModalError(null);
  }, []);

  // ------------------------------------------------------------------
  // Tabs config
  // ------------------------------------------------------------------
  const tabs = [
    { id: "all", content: `All (${stats.total})` },
    { id: "under_review", content: `Under Review (${stats.under_review})` },
    { id: "planned", content: `Planned (${stats.planned})` },
    { id: "in_progress", content: `In Progress (${stats.in_progress})` },
    { id: "done", content: `Done (${stats.done})` },
  ];

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <Page
      title="Feature Requests"
      subtitle="Vote on features or suggest new ones. We review every request and ship based on community votes."
      backAction={{ onAction: () => navigate("/app") }}
      primaryAction={{
        content: "Suggest a Feature",
        icon: PlusIcon,
        onAction: () => setModalOpen(true),
      }}
      titleMetadata={
        isAdmin ? <Badge tone="info">Admin</Badge> : undefined
      }
    >
      <Box paddingBlockEnd="1600">
        <Layout>

          {/* ---- Stats Bar ---- */}
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
                    Total Requests
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
                    Under Review
                  </Text>
                  <Text
                    as="p"
                    variant="headingXl"
                    fontWeight="bold"
                    tone="caution"
                  >
                    {stats.under_review}
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
                    Planned
                  </Text>
                  <Text as="p" variant="headingXl" fontWeight="bold">
                    {stats.planned}
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
                    In Progress
                  </Text>
                  <Text as="p" variant="headingXl" fontWeight="bold">
                    {stats.in_progress}
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
                    Done / Shipped
                  </Text>
                  <Text
                    as="p"
                    variant="headingXl"
                    fontWeight="bold"
                    tone="success"
                  >
                    {stats.done}
                  </Text>
                </BlockStack>
              </Box>
            </InlineGrid>
          </Layout.Section>

          {/* ---- Filter Tabs + Sort + List ---- */}
          <Layout.Section>
            <Card padding="0">
              {/* Tabs */}
              <Tabs
                tabs={tabs}
                selected={selectedTab}
                onSelect={handleTabChange}
              />
              <Divider />

              {/* Sort bar */}
              <Box padding="400">
                <InlineStack align="end">
                  <Box minWidth="180px">
                    <Select
                      label="Sort by"
                      labelInline
                      options={SORT_OPTIONS}
                      value={sortValue}
                      onChange={handleSortChange}
                    />
                  </Box>
                </InlineStack>
              </Box>
              <Divider />

              {/* Feature list */}
              {filteredFeatures.length === 0 ? (
                <EmptyState
                  heading="No feature requests yet"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  action={{
                    content: "Suggest a Feature",
                    onAction: () => setModalOpen(true),
                  }}
                >
                  <Text as="p">
                    {tabFilter === "all"
                      ? "Be the first to suggest a feature. We review every request and ship based on community votes."
                      : "No feature requests with this status yet."}
                  </Text>
                </EmptyState>
              ) : (
                <BlockStack gap="0">
                  {paginatedFeatures.map((feature, index) => {
                    const isVoted = votedIds.has(feature.id);
                    const isOwner = feature.shop === shop;
                    const canDelete = isOwner || isAdmin;
                    const isExpanded = expandedIds.has(feature.id);
                    const needsTruncation = feature.description.length > 160;
                    const displayDescription = isExpanded
                      ? feature.description
                      : truncateText(feature.description, 160);

                    return (
                      <Box key={feature.id}>
                        {index > 0 && <Divider />}
                        <Box padding="400">
                          <InlineStack
                            gap="400"
                            align="start"
                            blockAlign="start"
                            wrap={false}
                          >
                            {/* Vote button */}
                            <Box minWidth="56px">
                              <BlockStack gap="050" inlineAlign="center">
                                <Button
                                  variant={isVoted ? "primary" : "secondary"}
                                  size="slim"
                                  icon={ChevronUpIcon}
                                  onClick={() => handleVote(feature.id)}
                                  loading={
                                    pendingVoteId === feature.id &&
                                    voteFetcher.state !== "idle"
                                  }
                                  accessibilityLabel={
                                    isVoted
                                      ? "Remove vote"
                                      : "Vote for this feature"
                                  }
                                />
                                <Text
                                  as="p"
                                  variant="headingSm"
                                  fontWeight="bold"
                                  alignment="center"
                                  tone={isVoted ? "success" : undefined}
                                >
                                  {feature.votesCount}
                                </Text>
                              </BlockStack>
                            </Box>

                            {/* Content */}
                            <Box width="100%">
                              <BlockStack gap="200">
                                <InlineStack
                                  align="space-between"
                                  blockAlign="start"
                                  wrap
                                >
                                  <Text
                                    as="p"
                                    variant="bodyMd"
                                    fontWeight="semibold"
                                  >
                                    {feature.title}
                                  </Text>
                                  <InlineStack
                                    gap="200"
                                    blockAlign="center"
                                    wrap
                                  >
                                    {/* Admin: status dropdown; Regular: static badge */}
                                    {isAdmin ? (
                                      <Box minWidth="140px">
                                        <Select
                                          label="Status"
                                          labelHidden
                                          options={STATUS_OPTIONS}
                                          value={feature.status}
                                          onChange={(val) =>
                                            handleStatusChange(feature.id, val)
                                          }
                                        />
                                      </Box>
                                    ) : (
                                      <Badge
                                        tone={STATUS_TONES[feature.status]}
                                      >
                                        {STATUS_LABELS[feature.status] ??
                                          feature.status}
                                      </Badge>
                                    )}
                                    <Badge>{feature.category}</Badge>
                                  </InlineStack>
                                </InlineStack>

                                <Text as="p" tone="subdued" variant="bodySm">
                                  {displayDescription}
                                  {needsTruncation && (
                                    <>
                                      {" "}
                                      <Button
                                        variant="plain"
                                        size="slim"
                                        onClick={() =>
                                          handleToggleExpand(feature.id)
                                        }
                                      >
                                        {isExpanded
                                          ? "Show less"
                                          : "View details"}
                                      </Button>
                                    </>
                                  )}
                                </Text>

                                <InlineStack
                                  gap="400"
                                  blockAlign="center"
                                  wrap
                                >
                                  <Text
                                    as="p"
                                    tone="subdued"
                                    variant="bodySm"
                                  >
                                    Submitted {formatDate(feature.createdAt)}
                                  </Text>
                                  {canDelete && (
                                    <Button
                                      variant="plain"
                                      tone="critical"
                                      size="slim"
                                      icon={DeleteIcon}
                                      onClick={() =>
                                        handleDelete(feature.id)
                                      }
                                      loading={
                                        pendingDeleteId === feature.id &&
                                        deleteFetcher.state !== "idle"
                                      }
                                      accessibilityLabel="Delete feature request"
                                    >
                                      Delete
                                    </Button>
                                  )}
                                </InlineStack>
                              </BlockStack>
                            </Box>
                          </InlineStack>
                        </Box>
                      </Box>
                    );
                  })}
                </BlockStack>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <>
                  <Divider />
                  <Box padding="400">
                    <InlineStack align="center" gap="400" blockAlign="center">
                      <Button
                        disabled={currentPage <= 1}
                        onClick={() =>
                          setCurrentPage((p) => Math.max(1, p - 1))
                        }
                      >
                        Previous
                      </Button>
                      <Text as="p" tone="subdued" variant="bodySm">
                        Page {currentPage} of {totalPages} (
                        {filteredFeatures.length} requests)
                      </Text>
                      <Button
                        disabled={currentPage >= totalPages}
                        onClick={() =>
                          setCurrentPage((p) => Math.min(totalPages, p + 1))
                        }
                      >
                        Next
                      </Button>
                    </InlineStack>
                  </Box>
                </>
              )}
            </Card>
          </Layout.Section>

        </Layout>
      </Box>

      {/* ---- Suggest a Feature Modal ---- */}
      <Modal
        open={modalOpen}
        onClose={handleCloseModal}
        title="Suggest a Feature"
        primaryAction={{
          content: "Submit Request",
          onAction: handleSubmitFeature,
          loading: submitFetcher.state !== "idle",
        }}
        secondaryActions={[{ content: "Cancel", onAction: handleCloseModal }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {modalError && (
              <Banner tone="critical" onDismiss={() => setModalError(null)}>
                {modalError}
              </Banner>
            )}
            <TextField
              label="Title"
              value={newTitle}
              onChange={setNewTitle}
              placeholder="e.g. Export ZIP codes to CSV"
              autoComplete="off"
              maxLength={150}
              showCharacterCount
              helpText="Keep it short and descriptive."
            />
            <TextField
              label="Description"
              value={newDescription}
              onChange={setNewDescription}
              placeholder="Describe the feature and why it would be valuable..."
              autoComplete="off"
              multiline={4}
              maxLength={MAX_DESCRIPTION_LENGTH}
              showCharacterCount
              helpText="The more context you provide, the better we can understand your needs."
            />
            <Select
              label="Category"
              options={CATEGORY_OPTIONS}
              value={newCategory}
              onChange={setNewCategory}
              helpText="Choose the category that best fits your request."
            />
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

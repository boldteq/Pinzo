import { useState, useCallback, useMemo, useEffect, useRef } from "react";
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

type ActionResult =
  | { success: true; intent: string; featureId?: string; newCount?: number; voted?: boolean }
  | { error: string };

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [features, myVotes] = await Promise.all([
    db.featureRequest.findMany({
      orderBy: { votesCount: "desc" },
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

  return { features, votedIds, shop, stats };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  try {
    switch (intent) {
      case "submit": {
        const title = String(formData.get("title") ?? "").trim();
        const description = String(formData.get("description") ?? "").trim();
        const category = String(formData.get("category") ?? "General").trim();

        if (!title || !description) {
          return { error: "Title and description are required." };
        }
        if (title.length > 150) {
          return { error: "Title must be 150 characters or fewer." };
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

        let newCount: number;
        let voted: boolean;

        if (existing) {
          await db.featureVote.delete({ where: { id: existing.id } });
          newCount = Math.max(0, feature.votesCount - 1);
          await db.featureRequest.update({
            where: { id: featureId },
            data: { votesCount: newCount },
          });
          voted = false;
        } else {
          await db.featureVote.create({
            data: { featureRequestId: featureId, shop },
          });
          newCount = feature.votesCount + 1;
          await db.featureRequest.update({
            where: { id: featureId },
            data: { votesCount: newCount },
          });
          voted = true;
        }

        return { success: true, intent: "vote", featureId, newCount, voted };
      }

      case "delete": {
        const deleteId = String(formData.get("id") ?? "").trim();
        if (!deleteId) return { error: "Feature ID is required." };

        const toDelete = await db.featureRequest.findUnique({
          where: { id: deleteId },
        });
        if (!toDelete) return { error: "Feature request not found." };
        if (toDelete.shop !== shop) {
          return { error: "You can only delete your own feature requests." };
        }

        await db.featureRequest.delete({ where: { id: deleteId } });
        return { success: true, intent: "delete" };
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
// Helpers
// ---------------------------------------------------------------------------

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
// Component
// ---------------------------------------------------------------------------

export default function FeatureRequestsPage() {
  const {
    features: rawFeatures,
    votedIds: initialVotedIds,
    shop,
    stats,
  } = useLoaderData<typeof loader>();

  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();

  // Track the pending operation details so we can use them inside useEffect
  // without relying on fetcher.formData (which has a narrow type in generics)
  const pendingIntentRef = useRef<string | null>(null);
  const pendingFeatureIdRef = useRef<string | null>(null);
  const pendingDeleteIdRef = useRef<string | null>(null);

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
  const [isSubmitting, setIsSubmitting] = useState(false);

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
  // Handle fetcher responses
  // ------------------------------------------------------------------
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;

    const data = fetcher.data;
    const lastIntent = pendingIntentRef.current;

    if ("error" in data) {
      if (lastIntent === "submit") {
        setModalError(data.error);
      } else {
        shopify.toast.show(data.error, { isError: true });
      }
      setPendingVoteId(null);
      setPendingDeleteId(null);
      setIsSubmitting(false);
      return;
    }

    if ("success" in data && data.success) {
      if (data.intent === "submit") {
        shopify.toast.show("Feature request submitted! Thank you.");
        setModalOpen(false);
        setNewTitle("");
        setNewDescription("");
        setNewCategory("General");
        setModalError(null);
        setIsSubmitting(false);
      } else if (data.intent === "vote") {
        const fid = data.featureId;
        if (fid !== undefined) {
          setOptimisticVotes((prev) => {
            const next = new Map(prev);
            if (data.newCount !== undefined) {
              next.set(fid, {
                count: data.newCount,
                voted: data.voted ?? false,
              });
            }
            return next;
          });
          setVotedIds((prev) => {
            const next = new Set(prev);
            if (data.voted) next.add(fid);
            else next.delete(fid);
            return next;
          });
        }
        setPendingVoteId(null);
      } else if (data.intent === "delete") {
        shopify.toast.show("Feature request deleted.");
        setPendingDeleteId(null);
      }
    }
  }, [fetcher.state, fetcher.data, shopify]);

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

      pendingIntentRef.current = "vote";
      pendingFeatureIdRef.current = featureId;
      setPendingVoteId(featureId);

      const fd = new FormData();
      fd.set("intent", "vote");
      fd.set("featureId", featureId);
      fetcher.submit(fd, { method: "POST" });
    },
    [features, votedIds, optimisticVotes, fetcher],
  );

  const handleDelete = useCallback(
    (id: string) => {
      pendingIntentRef.current = "delete";
      pendingDeleteIdRef.current = id;
      setPendingDeleteId(id);

      const fd = new FormData();
      fd.set("intent", "delete");
      fd.set("id", id);
      fetcher.submit(fd, { method: "POST" });
    },
    [fetcher],
  );

  const handleSubmitFeature = useCallback(() => {
    if (!newTitle.trim() || !newDescription.trim()) {
      setModalError("Title and description are required.");
      return;
    }
    setModalError(null);
    pendingIntentRef.current = "submit";
    setIsSubmitting(true);

    const fd = new FormData();
    fd.set("intent", "submit");
    fd.set("title", newTitle.trim());
    fd.set("description", newDescription.trim());
    fd.set("category", newCategory);
    fetcher.submit(fd, { method: "POST" });
  }, [newTitle, newDescription, newCategory, fetcher]);

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
                                    fetcher.state !== "idle"
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
                                    <Badge
                                      tone={STATUS_TONES[feature.status]}
                                    >
                                      {STATUS_LABELS[feature.status] ??
                                        feature.status}
                                    </Badge>
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
                                  {isOwner && (
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
                                        fetcher.state !== "idle"
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
          loading: isSubmitting,
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

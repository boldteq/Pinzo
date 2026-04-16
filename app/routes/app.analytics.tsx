import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams, Link } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Select,
  Badge,
  Banner,
  Button,
  IndexTable,
  useIndexResourceState,
  EmptyState,
  Box,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getShopSubscription } from "../billing.server";

type ResultType = "allowed" | "blocked" | "not_found" | "defaulted_allow";

interface LogEntry {
  id: string;
  zipCode: string;
  result: ResultType;
  productId: string | null;
  createdAt: string;
}

interface TopDemandedZip {
  zipCode: string;
  count: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const daysParam = url.searchParams.get("days") ?? "7";
  const days = daysParam === "all" ? null : parseInt(daysParam, 10) || 7;

  const subscription = await getShopSubscription(shop);
  const limits = subscription.limits;

  if (!limits.zipLogs) {
    return {
      hasAccess: false,
      planLabel: limits.label,
      days: daysParam,
      totalChecks: 0,
      allowedChecks: 0,
      blockedChecks: 0,
      notFoundChecks: 0,
      defaultedChecks: 0,
      successRate: 0,
      topDemanded: [] as TopDemandedZip[],
      recentLogs: [] as LogEntry[],
    };
  }

  const since = days ? new Date(Date.now() - days * 86_400_000) : null;
  const baseWhere = since
    ? { shop, createdAt: { gte: since } }
    : { shop };

  const [
    totalChecks,
    allowedChecks,
    blockedChecks,
    notFoundChecks,
    defaultedChecks,
    topDemandedRaw,
    recentLogsRaw,
  ] = await Promise.all([
    db.zipCheckLog.count({ where: baseWhere }),
    db.zipCheckLog.count({ where: { ...baseWhere, result: "allowed" } }),
    db.zipCheckLog.count({ where: { ...baseWhere, result: "blocked" } }),
    db.zipCheckLog.count({ where: { ...baseWhere, result: "not_found" } }),
    db.zipCheckLog.count({ where: { ...baseWhere, result: "defaulted_allow" } }),
    db.zipCheckLog.groupBy({
      by: ["zipCode"],
      where: { ...baseWhere, result: { in: ["not_found", "blocked"] } },
      _count: { zipCode: true },
      orderBy: { _count: { zipCode: "desc" } },
      take: 10,
    }),
    db.zipCheckLog.findMany({
      where: baseWhere,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, zipCode: true, result: true, productId: true, createdAt: true },
    }),
  ]);

  const successRate =
    totalChecks > 0
      ? Math.round(((allowedChecks + defaultedChecks) / totalChecks) * 100)
      : 0;

  return {
    hasAccess: true,
    planLabel: limits.label,
    days: daysParam,
    totalChecks,
    allowedChecks,
    blockedChecks,
    notFoundChecks,
    defaultedChecks,
    successRate,
    topDemanded: topDemandedRaw.map((r) => ({
      zipCode: r.zipCode,
      count: r._count.zipCode,
    })) as TopDemandedZip[],
    recentLogs: recentLogsRaw.map((l) => ({
      ...l,
      createdAt: l.createdAt.toISOString(),
    })) as LogEntry[],
  };
};

function resultBadge(result: ResultType) {
  switch (result) {
    case "allowed":
      return <Badge tone="success">Allowed</Badge>;
    case "defaulted_allow":
      return <Badge tone="info">Allowed (default)</Badge>;
    case "blocked":
      return <Badge tone="critical">Blocked</Badge>;
    case "not_found":
      return <Badge tone="warning">Not Found</Badge>;
  }
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text variant="bodySm" tone="subdued" as="p">
          {label}
        </Text>
        <Text variant="headingXl" as="p">
          {value}
        </Text>
        {sub && (
          <Text variant="bodySm" tone="subdued" as="p">
            {sub}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

export default function AnalyticsPage() {
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const {
    hasAccess,
    days,
    totalChecks,
    allowedChecks,
    blockedChecks,
    notFoundChecks,
    defaultedChecks,
    successRate,
    topDemanded,
    recentLogs,
  } = data;

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(recentLogs as unknown as { [key: string]: unknown }[]);

  if (!hasAccess) {
    return (
      <Page title="Analytics">
        <Layout>
          <Layout.Section>
            <Banner
              title="Analytics is a Starter+ feature"
              tone="info"
              action={{ content: "Upgrade Plan", url: "/app/pricing" }}
            >
              <p>
                Upgrade to Starter or higher to track ZIP check events, see
                success rates, and discover which areas customers are searching
                for.
              </p>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const dayOptions = [
    { label: "Last 7 days", value: "7" },
    { label: "Last 30 days", value: "30" },
    { label: "Last 90 days", value: "90" },
    { label: "All time", value: "all" },
  ];

  const failedChecks = blockedChecks + notFoundChecks;

  return (
    <Page
      title="Analytics"
      subtitle="ZIP code check events from your storefront widget"
      secondaryActions={[
        {
          content: "View ZIP Codes",
          url: "/app/zip-codes",
        },
      ]}
    >
      <Layout>
        {/* Date filter */}
        <Layout.Section>
          <InlineStack align="end">
            <div style={{ width: "200px" }}>
              <Select
                label="Date range"
                labelHidden
                options={dayOptions}
                value={days}
                onChange={(v) => {
                  const next = new URLSearchParams(searchParams);
                  next.set("days", v);
                  setSearchParams(next);
                }}
              />
            </div>
          </InlineStack>
        </Layout.Section>

        {/* Stat cards */}
        <Layout.Section>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "16px",
            }}
          >
            <StatCard label="Total Checks" value={totalChecks.toLocaleString()} />
            <StatCard
              label="Success Rate"
              value={`${successRate}%`}
              sub={`${(allowedChecks + defaultedChecks).toLocaleString()} delivered`}
            />
            <StatCard
              label="Blocked / Not Found"
              value={failedChecks.toLocaleString()}
              sub={`${blockedChecks} blocked · ${notFoundChecks} not found`}
            />
            <StatCard
              label="Allowed (default)"
              value={defaultedChecks.toLocaleString()}
              sub="Unlisted ZIP, allow mode"
            />
          </div>
        </Layout.Section>

        {/* Top demanded ZIPs */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" as="h2">
                  Top Demanded ZIP Codes (No Coverage)
                </Text>
                <Button variant="plain" url="/app/zip-codes">
                  Add ZIP Codes
                </Button>
              </InlineStack>
              <Divider />
              {topDemanded.length === 0 ? (
                <Box paddingBlockStart="400" paddingBlockEnd="400">
                  <Text as="p" tone="subdued" alignment="center">
                    No failed checks yet in this period
                  </Text>
                </Box>
              ) : (
                <BlockStack gap="200">
                  {topDemanded.map((item, idx) => (
                    <InlineStack key={item.zipCode} align="space-between" blockAlign="center">
                      <InlineStack gap="300" blockAlign="center">
                        <div
                          style={{
                            width: "24px",
                            height: "24px",
                            borderRadius: "50%",
                            background: "#F1F1F1",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "#6D7175",
                          }}
                        >
                          {idx + 1}
                        </div>
                        <Text as="span" fontWeight="semibold">
                          {item.zipCode}
                        </Text>
                      </InlineStack>
                      <InlineStack gap="300" blockAlign="center">
                        <Badge tone="warning">{`${item.count.toLocaleString()} searches`}</Badge>
                        <Link to={`/app/zip-codes?prefill=${item.zipCode}`}>
                          <Button size="slim" variant="plain">
                            Add
                          </Button>
                        </Link>
                      </InlineStack>
                    </InlineStack>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Recent log table */}
        <Layout.Section>
          <Card padding="0">
            <Box paddingInlineStart="400" paddingInlineEnd="400" paddingBlockStart="400">
              <Text variant="headingMd" as="h2">
                Recent ZIP Check Logs
              </Text>
            </Box>
            {recentLogs.length === 0 ? (
              <EmptyState
                heading="No check logs yet"
                image=""
              >
                <p>
                  Logs appear here once customers start using the ZIP code
                  widget on your storefront.
                </p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "log", plural: "logs" }}
                itemCount={recentLogs.length}
                selectedItemsCount={
                  allResourcesSelected ? "All" : selectedResources.length
                }
                onSelectionChange={handleSelectionChange}
                headings={[
                  { title: "ZIP Code" },
                  { title: "Result" },
                  { title: "Product" },
                  { title: "Time" },
                ]}
                selectable={false}
              >
                {recentLogs.map((log, index) => (
                  <IndexTable.Row id={log.id} key={log.id} position={index}>
                    <IndexTable.Cell>
                      <Text variant="bodyMd" fontWeight="semibold" as="span">
                        {log.zipCode}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{resultBadge(log.result)}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" tone="subdued">
                        {log.productId ?? "—"}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" tone="subdued">
                        {timeAgo(log.createdAt)}
                      </Text>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

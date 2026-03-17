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
import { getShopSubscription } from "../billing.server";
import { PLAN_LIMITS, UNLIMITED } from "../plans";
import {
  Page,
  Layout,
  Card,
  TextField,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  DataTable,
  Modal,
  Select,
  Divider,
  EmptyState,
  Box,
  Icon,
  Tooltip,
  DropZone,
  Pagination,
} from "@shopify/polaris";
import {
  SearchIcon,
  DeleteIcon,
  EditIcon,
  PlusIcon,
  StarIcon,
  ImportIcon,
  ExportIcon,
} from "@shopify/polaris-icons";

const PAGE_SIZE = 10;

/** RFC-4180 compliant CSV row parser — handles quoted fields containing commas. */
function parseCsvRow(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cols.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols;
}

/** Downloads a pre-filled sample CSV template the user can fill in and import. */
function downloadSampleCsv() {
  const sample = [
    "Zip Code,Zone,Status,Message,ETA,COD,Return Policy",
    "10001,Manhattan,allowed,We deliver here! Estimated 2-3 days.,2-3 days,Yes,30-day returns accepted",
    "90210,Beverly Hills,allowed,Same day delivery available.,1 day,No,",
    "33101,Miami,blocked,Sorry we do not deliver to this area.,,",
  ].join("\n");
  const blob = new Blob([sample], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sample-zip-codes.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [zipCodes, subscription] = await Promise.all([
    db.zipCode.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
    }),
    getShopSubscription(shop),
  ]);

  const stats = {
    total: zipCodes.length,
    allowed: zipCodes.filter((z) => z.type === "allowed").length,
    blocked: zipCodes.filter((z) => z.type === "blocked").length,
    active: zipCodes.filter((z) => z.isActive).length,
  };

  return { zipCodes, stats, subscription };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "add") {
    const zipCode = String(formData.get("zipCode")).trim().toUpperCase();
    const label = String(formData.get("label") || "").trim();
    const zone = String(formData.get("zone") || "").trim();
    const message = String(formData.get("message") || "").trim();
    const eta = String(formData.get("eta") || "").trim();
    const type = String(formData.get("type") || "allowed");
    const codAvailable =
      formData.get("codAvailable") === "true"
        ? true
        : formData.get("codAvailable") === "false"
          ? false
          : null;
    const returnPolicy = (formData.get("returnPolicy") as string | null) || null;

    if (!zipCode) return { error: "Zip code is required." };

    const subscription = await getShopSubscription(shop);
    const limits = PLAN_LIMITS[subscription.planTier];

    if (type === "blocked" && !limits.allowBlocked) {
      return {
        error:
          "Blocked zip codes are not available on your current plan. Upgrade to Pro or Ultimate to use blocked zip codes.",
        upgradeRequired: true,
      };
    }

    const currentCount = await db.zipCode.count({ where: { shop } });
    if (limits.maxZipCodes < UNLIMITED && currentCount >= limits.maxZipCodes) {
      const upgradeTarget =
        subscription.planTier === "free" ? "Starter" : "Pro";
      return {
        error: `You have reached the ${limits.maxZipCodes} zip code limit on the ${limits.label} plan. Upgrade to ${upgradeTarget} for a higher limit.`,
        upgradeRequired: true,
      };
    }

    try {
      await db.zipCode.create({
        data: {
          shop,
          zipCode,
          label: label || null,
          zone: zone || null,
          message: message || null,
          eta: eta || null,
          type,
          codAvailable: codAvailable ?? undefined,
          returnPolicy: returnPolicy ?? undefined,
        },
      });
      return { success: true, action: "added", zipCode };
    } catch {
      return { error: `Zip code "${zipCode}" already exists.` };
    }
  }

  if (intent === "delete") {
    const id = String(formData.get("id"));
    try {
      const existing = await db.zipCode.findFirst({ where: { id, shop } });
      if (!existing) return { error: "Zip code not found." };
      await db.zipCode.delete({ where: { id } });
      return { success: true, action: "deleted" };
    } catch {
      return { error: "Failed to delete zip code." };
    }
  }

  if (intent === "update") {
    const id = String(formData.get("id"));
    const zipCode = String(formData.get("zipCode")).trim().toUpperCase();
    const label = String(formData.get("label") || "").trim();
    const zone = String(formData.get("zone") || "").trim();
    const message = String(formData.get("message") || "").trim();
    const eta = String(formData.get("eta") || "").trim();
    const type = String(formData.get("type") || "allowed");
    const isActive = formData.get("isActive") === "true";
    const codAvailable =
      formData.get("codAvailable") === "true"
        ? true
        : formData.get("codAvailable") === "false"
          ? false
          : null;
    const returnPolicy = (formData.get("returnPolicy") as string | null) || null;

    if (!zipCode) return { error: "Zip code is required." };

    try {
      const existing = await db.zipCode.findFirst({ where: { id, shop } });
      if (!existing) return { error: "Zip code not found." };
      await db.zipCode.update({
        where: { id },
        data: {
          zipCode,
          label: label || null,
          zone: zone || null,
          message: message || null,
          eta: eta || null,
          type,
          isActive,
          codAvailable,
          returnPolicy,
        },
      });
      return { success: true, action: "updated", zipCode };
    } catch {
      return { error: `Failed to update zip code "${zipCode}". It may already exist.` };
    }
  }

  if (intent === "toggle") {
    const id = String(formData.get("id"));
    const isActive = formData.get("isActive") === "true";
    try {
      const existing = await db.zipCode.findFirst({ where: { id, shop } });
      if (!existing) return { error: "Zip code not found." };
      await db.zipCode.update({
        where: { id },
        data: { isActive: !isActive },
      });
      return { success: true, action: "toggled" };
    } catch {
      return { error: "Failed to toggle zip code status." };
    }
  }

  if (intent === "check") {
    const zipCode = String(formData.get("checkZip")).trim().toUpperCase();
    try {
      const found = await db.zipCode.findUnique({
        where: { shop_zipCode: { shop, zipCode } },
      });
      if (!found) return { checkResult: { found: false, zipCode } };
      return { checkResult: { found: true, zipCode, record: found } };
    } catch {
      return { error: "Failed to check zip code." };
    }
  }

  if (intent === "bulk-import") {
    const csvData = String(formData.get("csvData") || "");
    if (!csvData.trim()) return { error: "No CSV data provided." };

    const subscription = await getShopSubscription(shop);
    const limits = PLAN_LIMITS[subscription.planTier];

    if (!limits.csvImport) {
      const upgradeTarget =
        subscription.planTier === "free" ? "Starter" : "Pro";
      return {
        error: `CSV import is not available on the ${limits.label} plan. Upgrade to ${upgradeTarget} to import zip codes via CSV.`,
        upgradeRequired: true,
      };
    }

    const lines = csvData
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    // Skip header row if present
    const startIdx =
      lines.length > 0 &&
      lines[0].toLowerCase().includes("zip")
        ? 1
        : 0;

    const currentCount = await db.zipCode.count({ where: { shop } });
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = startIdx; i < lines.length; i++) {
      const cols = parseCsvRow(lines[i]);
      const zipCode = (cols[0] || "").toUpperCase();
      if (!zipCode) continue;

      const zone = cols[1] || null;
      const type = (cols[2] || "allowed").toLowerCase() === "blocked" ? "blocked" : "allowed";
      const message = cols[3] || null;
      const eta = cols[4] || null;
      const codRaw = (cols[5] || "").toLowerCase().trim();
      const codAvailable =
        codRaw === "yes" || codRaw === "true"
          ? true
          : codRaw === "no" || codRaw === "false"
            ? false
            : null;
      const returnPolicy = cols[6] || null;

      if (type === "blocked" && !limits.allowBlocked) {
        skipped++;
        continue;
      }

      if (
        limits.maxZipCodes < UNLIMITED &&
        currentCount + imported >= limits.maxZipCodes
      ) {
        const upgradeTarget =
          subscription.planTier === "free" ? "Starter" : "Pro";
        errors.push(
          `Reached the ${limits.maxZipCodes} zip code limit on the ${limits.label} plan. Upgrade to ${upgradeTarget} for a higher limit. ${lines.length - startIdx - imported - skipped} zip codes were not imported.`,
        );
        break;
      }

      try {
        await db.zipCode.upsert({
          where: { shop_zipCode: { shop, zipCode } },
          create: {
            shop,
            zipCode,
            zone,
            type,
            message,
            eta,
            codAvailable,
            returnPolicy,
          },
          update: {
            zone: zone ?? undefined,
            type,
            message: message ?? undefined,
            eta: eta ?? undefined,
            codAvailable,
            returnPolicy: returnPolicy ?? undefined,
          },
        });
        imported++;
      } catch {
        skipped++;
      }
    }

    return {
      success: true,
      action: "bulk-import",
      imported,
      skipped,
      errors,
    };
  }

  if (intent === "export") {
    const subscription = await getShopSubscription(shop);
    const limits = PLAN_LIMITS[subscription.planTier];

    if (!limits.csvExport) {
      return {
        error: `CSV export is not available on the ${limits.label} plan. Upgrade to Pro or Ultimate to export your zip codes.`,
        upgradeRequired: true,
      };
    }

    try {
      const zipCodes = await db.zipCode.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
      });

      const header = "Zip Code,Zone,Status,Message,ETA,Active,COD,Return Policy";
      const rows = zipCodes.map(
        (z) =>
          `"${z.zipCode}","${z.zone || ""}","${z.type}","${z.message || ""}","${z.eta || ""}","${z.isActive ? "Yes" : "No"}","${z.codAvailable === true ? "Yes" : z.codAvailable === false ? "No" : ""}","${z.returnPolicy || ""}"`,
      );
      const csv = [header, ...rows].join("\n");

      return { success: true, action: "export", csv };
    } catch {
      return { error: "Failed to export zip codes." };
    }
  }

  if (intent === "range-import") {
    const startZip = String(formData.get("startZip") || "").trim().toUpperCase();
    const endZip = String(formData.get("endZip") || "").trim().toUpperCase();
    const zone = (formData.get("zone") as string | null) || null;
    const type = (formData.get("type") as string) === "blocked" ? "blocked" : "allowed";
    const message = (formData.get("message") as string | null) || null;
    const eta = (formData.get("eta") as string | null) || null;

    // Validate: must be 5-digit numeric zips
    const ZIP_RE = /^\d{5}$/;
    if (!ZIP_RE.test(startZip) || !ZIP_RE.test(endZip)) {
      return { error: "ZIP range import only supports 5-digit US ZIP codes (e.g., 10001)." };
    }

    const start = parseInt(startZip, 10);
    const end = parseInt(endZip, 10);

    if (end < start) {
      return { error: "End ZIP must be greater than or equal to Start ZIP." };
    }

    const rangeSize = end - start + 1;
    const MAX_RANGE = 500;
    if (rangeSize > MAX_RANGE) {
      return { error: `Range too large. Maximum ${MAX_RANGE} zip codes per import (got ${rangeSize}).` };
    }

    // Check plan limits
    const subscription = await getShopSubscription(shop);
    const limits = PLAN_LIMITS[subscription.planTier];

    if (!limits.csvImport) {
      const upgradeTarget =
        subscription.planTier === "free" ? "Starter" : "Pro";
      return {
        error: `ZIP range import is not available on the ${limits.label} plan. Upgrade to ${upgradeTarget} to use bulk import features.`,
        upgradeRequired: true,
      };
    }

    if (type === "blocked" && !limits.allowBlocked) {
      return {
        error: "Blocked zip codes are not available on your current plan. Upgrade to Pro or Ultimate to use blocked zip codes.",
        upgradeRequired: true,
      };
    }

    const currentCount = await db.zipCode.count({ where: { shop } });
    if (limits.maxZipCodes < UNLIMITED && currentCount + rangeSize > limits.maxZipCodes) {
      const upgradeTarget =
        subscription.planTier === "free" ? "Starter" : "Pro";
      return {
        error: `This range would exceed your ${limits.label} plan limit of ${limits.maxZipCodes} zip codes. You have ${limits.maxZipCodes - currentCount} slots remaining. Upgrade to ${upgradeTarget} for a higher limit.`,
        upgradeRequired: true,
      };
    }

    // Generate and upsert all zips in range
    let imported = 0;
    for (let i = start; i <= end; i++) {
      const zipCode = String(i).padStart(5, "0");
      try {
        await db.zipCode.upsert({
          where: { shop_zipCode: { shop, zipCode } },
          create: { shop, zipCode, zone: zone ?? undefined, type, message: message ?? undefined, eta: eta ?? undefined },
          update: { zone: zone ?? undefined, type, message: message ?? undefined, eta: eta ?? undefined },
        });
        imported++;
      } catch {
        // skip individual errors
      }
    }

    return { success: true, action: "range-import", imported, total: rangeSize };
  }

  return null;
};

type ZipCodeRecord = {
  id: string;
  zipCode: string;
  label: string | null;
  zone: string | null;
  message: string | null;
  eta: string | null;
  type: string;
  isActive: boolean;
  codAvailable: boolean | null;
  returnPolicy: string | null;
  createdAt: string | Date;
};

export default function ZipCodeCheckerPage() {
  const { zipCodes, stats, subscription } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const downloadedCsvRef = useRef<string | null>(null);

  const limits = PLAN_LIMITS[subscription.planTier];
  const isFreePlan = subscription.planTier === "free";
  const isStarterPlan = subscription.planTier === "starter";
  const atZipLimit =
    limits.maxZipCodes < UNLIMITED && stats.total >= limits.maxZipCodes;

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);

  // Check zip code state
  const [checkZip, setCheckZip] = useState("");

  // Add modal state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newZip, setNewZip] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newZone, setNewZone] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [newEta, setNewEta] = useState("");
  const [newType, setNewType] = useState("allowed");
  const [newCodAvailable, setNewCodAvailable] = useState(""); // "", "true", "false"
  const [newReturnPolicy, setNewReturnPolicy] = useState("");

  // Edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [editZip, setEditZip] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editZone, setEditZone] = useState("");
  const [editMessage, setEditMessage] = useState("");
  const [editEta, setEditEta] = useState("");
  const [editType, setEditType] = useState("allowed");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editCodAvailable, setEditCodAvailable] = useState(""); // "", "true", "false"
  const [editReturnPolicy, setEditReturnPolicy] = useState("");

  // Import modal state
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);

  // Range import modal state
  const [rangeModalOpen, setRangeModalOpen] = useState(false);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [rangeZone, setRangeZone] = useState("");
  const [rangeType, setRangeType] = useState("allowed");
  const [rangeMessage, setRangeMessage] = useState("");
  const [rangeEta, setRangeEta] = useState("");

  const isCheckLoading =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "check";
  const isAddLoading =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "add";
  const isEditLoading =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "update";
  const isImportLoading =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "bulk-import";

  const checkResult =
    fetcher.data && "checkResult" in fetcher.data
      ? fetcher.data.checkResult
      : null;
  const actionError =
    fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const upgradeRequired =
    fetcher.data && "upgradeRequired" in fetcher.data
      ? fetcher.data.upgradeRequired
      : false;
  const importResult =
    fetcher.data &&
    "action" in fetcher.data &&
    fetcher.data.action === "bulk-import"
      ? fetcher.data
      : null;

  const rangeResult =
    fetcher.data &&
    "action" in fetcher.data &&
    fetcher.data.action === "range-import"
      ? fetcher.data
      : null;

  const isRangeLoading =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "range-import";

  // Filtered zip codes
  const filteredZipCodes = useMemo(() => {
    let filtered = zipCodes as ZipCodeRecord[];

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter(
        (z) =>
          z.zipCode.toLowerCase().includes(q) ||
          (z.zone && z.zone.toLowerCase().includes(q)) ||
          (z.label && z.label.toLowerCase().includes(q)) ||
          (z.message && z.message.toLowerCase().includes(q)),
      );
    }

    if (statusFilter === "allowed") {
      filtered = filtered.filter((z) => z.type === "allowed");
    } else if (statusFilter === "blocked") {
      filtered = filtered.filter((z) => z.type === "blocked");
    }

    return filtered;
  }, [zipCodes, searchQuery, statusFilter]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredZipCodes.length / PAGE_SIZE));
  const paginatedZipCodes = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredZipCodes.slice(start, start + PAGE_SIZE);
  }, [filteredZipCodes, currentPage]);

  // Reset to page 1 when search/filter changes
  const handleSearchChange = useCallback((val: string) => {
    setSearchQuery(val);
    setCurrentPage(1);
  }, []);

  const handleFilterChange = useCallback((val: string) => {
    setStatusFilter(val);
    setCurrentPage(1);
  }, []);

  const handleCheck = useCallback(() => {
    if (!checkZip.trim()) return;
    const fd = new FormData();
    fd.set("intent", "check");
    fd.set("checkZip", checkZip);
    fetcher.submit(fd, { method: "POST" });
  }, [checkZip, fetcher]);

  const handleAdd = useCallback(() => {
    if (!newZip.trim()) return;
    const fd = new FormData();
    fd.set("intent", "add");
    fd.set("zipCode", newZip);
    fd.set("label", newLabel);
    fd.set("zone", newZone);
    fd.set("message", newMessage);
    fd.set("eta", newEta);
    fd.set("type", newType);
    if (newCodAvailable !== "") fd.set("codAvailable", newCodAvailable);
    fd.set("returnPolicy", newReturnPolicy);
    fetcher.submit(fd, { method: "POST" });
    if (!actionError) {
      setNewZip("");
      setNewLabel("");
      setNewZone("");
      setNewMessage("");
      setNewEta("");
      setNewType("allowed");
      setNewCodAvailable("");
      setNewReturnPolicy("");
      setAddModalOpen(false);
    }
  }, [newZip, newLabel, newZone, newMessage, newEta, newType, newCodAvailable, newReturnPolicy, fetcher, actionError]);

  const handleDelete = useCallback(
    (id: string) => {
      const fd = new FormData();
      fd.set("intent", "delete");
      fd.set("id", id);
      fetcher.submit(fd, { method: "POST" });
      shopify.toast.show("Zip code removed");
    },
    [fetcher, shopify],
  );

  const handleOpenEdit = useCallback((z: ZipCodeRecord) => {
    setEditId(z.id);
    setEditZip(z.zipCode);
    setEditLabel(z.label || "");
    setEditZone(z.zone || "");
    setEditMessage(z.message || "");
    setEditEta(z.eta || "");
    setEditType(z.type);
    setEditIsActive(z.isActive);
    setEditCodAvailable(
      z.codAvailable === true ? "true" : z.codAvailable === false ? "false" : "",
    );
    setEditReturnPolicy(z.returnPolicy || "");
    setEditModalOpen(true);
  }, []);

  const handleUpdate = useCallback(() => {
    if (!editZip.trim()) return;
    const fd = new FormData();
    fd.set("intent", "update");
    fd.set("id", editId);
    fd.set("zipCode", editZip);
    fd.set("label", editLabel);
    fd.set("zone", editZone);
    fd.set("message", editMessage);
    fd.set("eta", editEta);
    fd.set("type", editType);
    fd.set("isActive", String(editIsActive));
    fd.set("codAvailable", editCodAvailable);
    fd.set("returnPolicy", editReturnPolicy);
    fetcher.submit(fd, { method: "POST" });
    setEditModalOpen(false);
    shopify.toast.show("Zip code updated");
  }, [editId, editZip, editLabel, editZone, editMessage, editEta, editType, editIsActive, editCodAvailable, editReturnPolicy, fetcher, shopify]);

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

  const handleImport = useCallback(() => {
    const dataToImport = csvText.trim();
    if (!dataToImport) return;
    const fd = new FormData();
    fd.set("intent", "bulk-import");
    fd.set("csvData", dataToImport);
    fetcher.submit(fd, { method: "POST" });
  }, [csvText, fetcher]);

  const handleFileUpload = useCallback(
    (_files: File[], acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        const file = acceptedFiles[0];
        setImportFile(file);
        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target?.result;
          if (typeof text === "string") {
            setCsvText(text);
          }
        };
        reader.readAsText(file);
      }
    },
    [],
  );

  const handleExport = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "export");
    fetcher.submit(fd, { method: "POST" });
  }, [fetcher]);

  const handleRangeImport = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "range-import");
    fd.set("startZip", rangeStart);
    fd.set("endZip", rangeEnd);
    if (rangeZone) fd.set("zone", rangeZone);
    fd.set("type", rangeType);
    if (rangeMessage) fd.set("message", rangeMessage);
    if (rangeEta) fd.set("eta", rangeEta);
    fetcher.submit(fd, { method: "POST" });
  }, [rangeStart, rangeEnd, rangeZone, rangeType, rangeMessage, rangeEta, fetcher]);

  // Trigger download when export data arrives — guarded by a content ref so the
  // effect only fires once per unique CSV payload, regardless of re-renders or
  // intermediate fetcher state transitions (submitting → loading → idle).
  useEffect(() => {
    const csvData =
      fetcher.data &&
      "action" in fetcher.data &&
      fetcher.data.action === "export" &&
      "csv" in fetcher.data
        ? (fetcher.data.csv as string)
        : null;

    if (csvData && downloadedCsvRef.current !== csvData) {
      downloadedCsvRef.current = csvData;
      const blob = new Blob([csvData], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "zip-codes.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [fetcher.data]);

  const typeOptions = [
    { label: "Allowed — permit this zip code", value: "allowed" },
    ...(limits.allowBlocked
      ? [{ label: "Blocked — deny this zip code", value: "blocked" }]
      : []),
  ];

  const filterOptions = [
    { label: "All", value: "all" },
    { label: "Allowed", value: "allowed" },
    { label: "Blocked", value: "blocked" },
  ];

  const tableRows = paginatedZipCodes.map((z) => [
    <Text as="span" fontWeight="bold" key={`zip-${z.id}`}>
      {z.zipCode}
    </Text>,
    z.zone || (
      <Text as="span" tone="subdued">
        —
      </Text>
    ),
    <InlineStack gap="300" blockAlign="center" key={`status-${z.id}`}>
      <Tooltip content={z.isActive ? "Click to deactivate" : "Click to activate"}>
        <Button
          variant="plain"
          tone={z.isActive ? "success" : undefined}
          onClick={() => handleToggle(z.id, z.isActive)}
          accessibilityLabel={z.isActive ? "Deactivate zip code" : "Activate zip code"}
        >
          {z.isActive ? "Active" : "Inactive"}
        </Button>
      </Tooltip>
      <Badge tone={z.type === "allowed" ? "success" : "critical"}>
        {z.type === "allowed" ? "Allow" : "Block"}
      </Badge>
    </InlineStack>,
    z.message || (
      <Text as="span" tone="subdued">
        —
      </Text>
    ),
    z.eta || (
      <Text as="span" tone="subdued">
        —
      </Text>
    ),
    z.codAvailable === true ? (
      <Badge tone="success" key={`cod-${z.id}`}>COD</Badge>
    ) : z.codAvailable === false ? (
      <Badge tone="critical" key={`cod-${z.id}`}>No COD</Badge>
    ) : (
      <Text as="span" tone="subdued" key={`cod-${z.id}`}>
        —
      </Text>
    ),
    <InlineStack gap="200" blockAlign="center" key={`actions-${z.id}`}>
      <Tooltip content="Edit zip code">
        <Button
          size="slim"
          variant="tertiary"
          onClick={() => handleOpenEdit(z)}
          icon={EditIcon}
          accessibilityLabel="Edit"
        />
      </Tooltip>
      <Tooltip content="Delete zip code">
        <Button
          size="slim"
          tone="critical"
          variant="tertiary"
          onClick={() => handleDelete(z.id)}
          icon={DeleteIcon}
          accessibilityLabel="Delete"
        />
      </Tooltip>
    </InlineStack>,
  ]);

  return (
    <Page
      title="Zip Code Checker"
      subtitle="Manage allowed and blocked zip codes for your store"
      primaryAction={
        atZipLimit
          ? {
              content: "Upgrade Plan",
              icon: StarIcon,
              onAction: () => navigate("/app/pricing"),
            }
          : {
              content: "Add Zip Code",
              icon: PlusIcon,
              onAction: () => setAddModalOpen(true),
            }
      }
    >
      <Box paddingBlockEnd="1600">
      <Layout>
        {/* Upgrade banner for free plan */}
        {isFreePlan && (
          <Layout.Section>
            <Banner
              title="Unlock more zip codes, blocked zones & CSV tools"
              tone="info"
              action={{
                content: "View Plans",
                onAction: () => navigate("/app/pricing"),
              }}
            >
              <Text as="p" variant="bodyMd">
                You&apos;re on the Free plan — limited to{" "}
                {limits.maxZipCodes} zip codes with no CSV import or blocked
                zones. Starter unlocks 500 zip codes and CSV import. Pro
                unlocks unlimited zip codes, blocked zones, CSV export, and
                more.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {/* Upgrade banner for starter plan — nudge toward Pro */}
        {isStarterPlan && (
          <Layout.Section>
            <Banner
              title="Unlock unlimited zip codes, blocked zones & CSV export"
              tone="info"
              action={{
                content: "View Plans",
                onAction: () => navigate("/app/pricing"),
              }}
            >
              <Text as="p" variant="bodyMd">
                You&apos;re on the Starter plan — limited to{" "}
                {limits.maxZipCodes} zip codes with no blocked zones or CSV
                export. Pro unlocks unlimited zip codes, blocked zones, CSV
                export, and delivery rules.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {/* Zip limit warning */}
        {atZipLimit && (
          <Layout.Section>
            <Banner
              title="Zip code limit reached"
              tone="warning"
              action={{
                content: `Upgrade to ${isFreePlan ? "Starter" : "Pro"}`,
                onAction: () => navigate("/app/pricing"),
              }}
            >
              You have reached the {limits.maxZipCodes} zip code limit on the{" "}
              {limits.label} plan. Upgrade to{" "}
              {isFreePlan ? "Starter" : "Pro"} for a higher limit.
            </Banner>
          </Layout.Section>
        )}

        {/* Stats Row */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 2, sm: 3, md: 5 }} gap="400">
            {/* Total */}
            <Card padding="400">
              <BlockStack gap="150">
                <Text as="p" tone="subdued" variant="bodySm">
                  Total Zip Codes
                </Text>
                <InlineStack gap="150" blockAlign="center">
                  <Text as="p" variant="headingXl" fontWeight="bold">
                    {stats.total}
                  </Text>
                  {limits.maxZipCodes < UNLIMITED && (
                    <Text as="p" tone="subdued" variant="bodySm">
                      / {limits.maxZipCodes}
                    </Text>
                  )}
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Allowed */}
            <Card padding="400">
              <BlockStack gap="150">
                <Text as="p" tone="success" variant="bodySm">
                  Allowed
                </Text>
                <Text as="p" variant="headingXl" fontWeight="bold" tone="success">
                  {stats.allowed}
                </Text>
              </BlockStack>
            </Card>

            {/* Blocked */}
            <Card padding="400">
              <BlockStack gap="150">
                <InlineStack gap="150" blockAlign="center">
                  <Text
                    as="p"
                    tone={!limits.allowBlocked ? "subdued" : "critical"}
                    variant="bodySm"
                  >
                    Blocked
                  </Text>
                  {!limits.allowBlocked && <Badge tone="info">Pro+</Badge>}
                </InlineStack>
                <Text
                  as="p"
                  variant="headingXl"
                  fontWeight="bold"
                  tone={!limits.allowBlocked ? "subdued" : "critical"}
                >
                  {stats.blocked}
                </Text>
              </BlockStack>
            </Card>

            {/* Active */}
            <Card padding="400">
              <BlockStack gap="150">
                <Text as="p" tone="subdued" variant="bodySm">
                  Active
                </Text>
                <Text as="p" variant="headingXl" fontWeight="bold">
                  {stats.active}
                </Text>
              </BlockStack>
            </Card>

            {/* Current Plan */}
            <Card padding="400">
              <BlockStack gap="150">
                <Text as="p" tone="subdued" variant="bodySm">
                  Current Plan
                </Text>
                {subscription.planTier === "ultimate" ? (
                  <Badge tone="success">Ultimate Plan</Badge>
                ) : subscription.planTier === "pro" ? (
                  <Badge tone="info">Pro Plan</Badge>
                ) : subscription.planTier === "starter" ? (
                  <Badge tone="attention">Starter Plan</Badge>
                ) : (
                  <Badge tone="new">Free Plan</Badge>
                )}
                {(isFreePlan || isStarterPlan) && (
                  <Button
                    variant="plain"
                    size="slim"
                    tone="success"
                    onClick={() => navigate("/app/pricing")}
                  >
                    Upgrade
                  </Button>
                )}
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        {/* Zip Code Checker Tool */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  Check a Zip Code
                </Text>
                <Text as="p" tone="subdued" variant="bodyMd">
                  Enter a zip code to instantly see if it&apos;s allowed or
                  blocked.
                </Text>
              </BlockStack>

              <InlineStack gap="300" blockAlign="end">
                {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
                <div
                  style={{ flex: 1 }}
                  role="search"
                  onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === "Enter") handleCheck();
                  }}
                >
                  <TextField
                    label="Zip code"
                    value={checkZip}
                    onChange={setCheckZip}
                    placeholder="e.g. 90210"
                    autoComplete="off"
                    labelHidden
                    prefix={<Icon source={SearchIcon} />}
                    connectedRight={
                      <Button
                        onClick={handleCheck}
                        loading={isCheckLoading}
                        variant="primary"
                      >
                        Check
                      </Button>
                    }
                  />
                </div>
              </InlineStack>

              {checkResult && (
                <Banner
                  tone={
                    !checkResult.found
                      ? "warning"
                      : checkResult.record?.type === "allowed"
                        ? "success"
                        : "critical"
                  }
                >
                  {!checkResult.found ? (
                    <Text as="p">
                      <strong>{checkResult.zipCode}</strong> is{" "}
                      <strong>not found</strong> in your zip code list.
                    </Text>
                  ) : checkResult.record?.type === "allowed" ? (
                    <Text as="p">
                      <strong>{checkResult.zipCode}</strong> is{" "}
                      <strong>allowed</strong>
                      {checkResult.record.zone
                        ? ` — Zone: ${checkResult.record.zone}`
                        : ""}
                      {checkResult.record.message
                        ? ` — ${checkResult.record.message}`
                        : ""}
                      {checkResult.record.eta
                        ? ` (ETA: ${checkResult.record.eta})`
                        : ""}
                      .{" "}
                      {!checkResult.record.isActive && (
                        <em>(Currently inactive)</em>
                      )}
                    </Text>
                  ) : (
                    <Text as="p">
                      <strong>{checkResult.zipCode}</strong> is{" "}
                      <strong>blocked</strong>
                      {checkResult.record?.zone
                        ? ` — Zone: ${checkResult.record.zone}`
                        : ""}
                      {checkResult.record?.message
                        ? ` — ${checkResult.record.message}`
                        : ""}
                      .{" "}
                      {!checkResult.record?.isActive && (
                        <em>(Currently inactive)</em>
                      )}
                    </Text>
                  )}
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Zip Code List */}
        <Layout.Section>
          <Card padding="0">
            {/* Toolbar: Search, Filter, Import, Export, Add */}
            <Box padding="400">
              <InlineStack gap="300" align="space-between" blockAlign="center" wrap>
                <InlineStack gap="300" blockAlign="center" wrap>
                  <div style={{ minWidth: "260px" }}>
                    <TextField
                      label="Search zip codes"
                      labelHidden
                      value={searchQuery}
                      onChange={handleSearchChange}
                      placeholder="Search zip codes..."
                      autoComplete="off"
                      prefix={<Icon source={SearchIcon} />}
                      clearButton
                      onClearButtonClick={() => handleSearchChange("")}
                    />
                  </div>
                  <div style={{ minWidth: "120px" }}>
                    <Select
                      label="Filter"
                      labelHidden
                      options={filterOptions}
                      value={statusFilter}
                      onChange={handleFilterChange}
                    />
                  </div>
                </InlineStack>
                <InlineStack gap="200">
                  <Tooltip
                    content={
                      !limits.csvImport
                        ? "CSV import requires Starter or higher — click to upgrade"
                        : "Import zip codes from a CSV file"
                    }
                  >
                    <Button
                      icon={!limits.csvImport ? StarIcon : ImportIcon}
                      onClick={
                        limits.csvImport
                          ? () => setImportModalOpen(true)
                          : () => navigate("/app/pricing")
                      }
                    >
                      Import CSV
                    </Button>
                  </Tooltip>
                  <Tooltip
                    content={
                      !limits.csvImport
                        ? "ZIP range import requires Starter or higher — click to upgrade"
                        : "Import a range of consecutive ZIP codes"
                    }
                  >
                    <Button
                      icon={!limits.csvImport ? StarIcon : ImportIcon}
                      onClick={
                        limits.csvImport
                          ? () => setRangeModalOpen(true)
                          : () => navigate("/app/pricing")
                      }
                    >
                      Import Range
                    </Button>
                  </Tooltip>
                  <Tooltip
                    content={
                      !limits.csvExport
                        ? "CSV export requires Pro or higher — click to upgrade"
                        : "Export all zip codes to a CSV file"
                    }
                  >
                    <Button
                      icon={!limits.csvExport ? StarIcon : ExportIcon}
                      onClick={
                        limits.csvExport
                          ? handleExport
                          : () => navigate("/app/pricing")
                      }
                    >
                      Export
                    </Button>
                  </Tooltip>
                  {!atZipLimit && (
                    <Button
                      icon={PlusIcon}
                      onClick={() => setAddModalOpen(true)}
                    >
                      Add Zip Code
                    </Button>
                  )}
                </InlineStack>
              </InlineStack>
            </Box>
            <Divider />

            {(zipCodes as ZipCodeRecord[]).length === 0 ? (
              <EmptyState
                heading="No zip codes added yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                action={{
                  content: "Add your first zip code",
                  onAction: () => setAddModalOpen(true),
                }}
                secondaryAction={{
                  content: "Import from CSV",
                  onAction: () => setImportModalOpen(true),
                }}
              >
                <p>
                  Add zip codes to control which areas are allowed or blocked
                  for your store. You can add them one by one or import a CSV
                  file.
                </p>
              </EmptyState>
            ) : filteredZipCodes.length === 0 ? (
              <Box padding="600">
                <BlockStack gap="200" inlineAlign="center">
                  <Text as="p" tone="subdued" alignment="center">
                    No zip codes match your search.
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
                    "text",
                    "text",
                  ]}
                  headings={[
                    "Zip Code",
                    "Zone",
                    "Status",
                    "Message",
                    "ETA",
                    "COD",
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
                        Page {currentPage} of {totalPages} ({filteredZipCodes.length} results)
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

      {/* Add Zip Code Modal */}
      <Modal
        open={addModalOpen}
        onClose={() => {
          setAddModalOpen(false);
          setNewZip("");
          setNewLabel("");
          setNewZone("");
          setNewMessage("");
          setNewEta("");
          setNewType("allowed");
          setNewCodAvailable("");
          setNewReturnPolicy("");
        }}
        title="Add Zip Code"
        primaryAction={{
          content: "Add Zip Code",
          onAction: handleAdd,
          loading: isAddLoading,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => {
              setAddModalOpen(false);
              setNewZip("");
              setNewLabel("");
              setNewZone("");
              setNewMessage("");
              setNewEta("");
              setNewType("allowed");
              setNewCodAvailable("");
              setNewReturnPolicy("");
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {actionError && (
              <Banner
                tone="critical"
                action={
                  upgradeRequired
                    ? {
                        content: "View Pricing Plans",
                        onAction: () => {
                          setAddModalOpen(false);
                          navigate("/app/pricing");
                        },
                      }
                    : undefined
                }
              >
                {actionError}
              </Banner>
            )}
            <TextField
              label="Zip Code"
              value={newZip}
              onChange={setNewZip}
              placeholder="e.g. 90210"
              autoComplete="off"
              helpText="Enter a 5-digit US zip code or postal code."
            />
            <InlineStack gap="300">
              <div style={{ flex: 1 }}>
                <TextField
                  label="Zone"
                  value={newZone}
                  onChange={setNewZone}
                  placeholder="e.g. Manhattan, Beverly Hills"
                  autoComplete="off"
                  helpText="The delivery zone or area name."
                />
              </div>
              <div style={{ flex: 1 }}>
                <Select
                  label="Status"
                  options={typeOptions}
                  value={newType}
                  onChange={setNewType}
                  helpText={
                    !limits.allowBlocked
                      ? "Blocked zip codes require Pro or Ultimate plan."
                      : "Allow or block this zip code."
                  }
                />
              </div>
            </InlineStack>
            <TextField
              label="Message"
              value={newMessage}
              onChange={setNewMessage}
              placeholder="e.g. Delivery available!, Sorry we don't deliver here"
              autoComplete="off"
              helpText="Custom message shown to customers for this zip code."
            />
            <InlineStack gap="300">
              <div style={{ flex: 1 }}>
                <TextField
                  label="ETA"
                  value={newEta}
                  onChange={setNewEta}
                  placeholder="e.g. 2-3 days"
                  autoComplete="off"
                  helpText="Estimated delivery time."
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Label (optional)"
                  value={newLabel}
                  onChange={setNewLabel}
                  placeholder="e.g. Downtown LA"
                  autoComplete="off"
                  helpText="Internal label for your reference."
                />
              </div>
            </InlineStack>
            <Select
              label="COD Available"
              options={[
                { label: "Not set", value: "" },
                { label: "Yes (COD available)", value: "true" },
                { label: "No (COD not available)", value: "false" },
              ]}
              value={newCodAvailable}
              onChange={setNewCodAvailable}
              helpText="Whether cash on delivery is available for this zip code."
            />
            <TextField
              label="Return / Exchange Policy"
              value={newReturnPolicy}
              onChange={setNewReturnPolicy}
              placeholder="e.g. 30-day returns accepted. Exchange within 7 days."
              autoComplete="off"
              multiline={3}
              helpText="Return and exchange policy displayed to customers for this zip code."
            />
            {!limits.allowBlocked && (
              <Banner tone="info">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="bodySm">
                    Want to block zip codes?{" "}
                  </Text>
                  <Button
                    variant="plain"
                    onClick={() => {
                      setAddModalOpen(false);
                      navigate("/app/pricing");
                    }}
                  >
                    Upgrade to Pro
                  </Button>
                </InlineStack>
              </Banner>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Edit Zip Code Modal */}
      <Modal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="Edit Zip Code"
        primaryAction={{
          content: "Save Changes",
          onAction: handleUpdate,
          loading: isEditLoading,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setEditModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {actionError && (
              <Banner tone="critical">{actionError}</Banner>
            )}
            <TextField
              label="Zip Code"
              value={editZip}
              onChange={setEditZip}
              placeholder="e.g. 90210"
              autoComplete="off"
              helpText="Enter a 5-digit US zip code or postal code."
            />
            <InlineStack gap="300">
              <div style={{ flex: 1 }}>
                <TextField
                  label="Zone"
                  value={editZone}
                  onChange={setEditZone}
                  placeholder="e.g. Manhattan, Beverly Hills"
                  autoComplete="off"
                  helpText="The delivery zone or area name."
                />
              </div>
              <div style={{ flex: 1 }}>
                <Select
                  label="Status"
                  options={typeOptions}
                  value={editType}
                  onChange={setEditType}
                  helpText={
                    !limits.allowBlocked
                      ? "Blocked zip codes require Pro or Ultimate plan."
                      : "Allow or block this zip code."
                  }
                />
              </div>
            </InlineStack>
            <TextField
              label="Message"
              value={editMessage}
              onChange={setEditMessage}
              placeholder="e.g. Delivery available!, Sorry we don't deliver here"
              autoComplete="off"
              helpText="Custom message shown to customers for this zip code."
            />
            <InlineStack gap="300">
              <div style={{ flex: 1 }}>
                <TextField
                  label="ETA"
                  value={editEta}
                  onChange={setEditEta}
                  placeholder="e.g. 2-3 days"
                  autoComplete="off"
                  helpText="Estimated delivery time."
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Label (optional)"
                  value={editLabel}
                  onChange={setEditLabel}
                  placeholder="e.g. Downtown LA"
                  autoComplete="off"
                  helpText="Internal label for your reference."
                />
              </div>
            </InlineStack>
            <Select
              label="Active"
              options={[
                { label: "Active — zip code is enabled", value: "true" },
                { label: "Inactive — zip code is disabled", value: "false" },
              ]}
              value={String(editIsActive)}
              onChange={(val) => setEditIsActive(val === "true")}
              helpText="Inactive zip codes are ignored by the widget."
            />
            <Select
              label="COD Available"
              options={[
                { label: "Not set", value: "" },
                { label: "Yes (COD available)", value: "true" },
                { label: "No (COD not available)", value: "false" },
              ]}
              value={editCodAvailable}
              onChange={setEditCodAvailable}
              helpText="Whether cash on delivery is available for this zip code."
            />
            <TextField
              label="Return / Exchange Policy"
              value={editReturnPolicy}
              onChange={setEditReturnPolicy}
              placeholder="e.g. 30-day returns accepted. Exchange within 7 days."
              autoComplete="off"
              multiline={3}
              helpText="Return and exchange policy displayed to customers for this zip code."
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Import CSV Modal */}
      <Modal
        open={importModalOpen}
        onClose={() => {
          setImportModalOpen(false);
          setCsvText("");
          setImportFile(null);
        }}
        title="Import Zip Codes from CSV"
        primaryAction={{
          content: isImportLoading ? "Importing..." : "Import",
          onAction: handleImport,
          loading: isImportLoading,
          disabled: !csvText.trim(),
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => {
              setImportModalOpen(false);
              setCsvText("");
              setImportFile(null);
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {actionError && !importResult && (
              <Banner
                tone="critical"
                action={
                  upgradeRequired
                    ? {
                        content: "View Pricing Plans",
                        onAction: () => {
                          setImportModalOpen(false);
                          navigate("/app/pricing");
                        },
                      }
                    : undefined
                }
              >
                {actionError}
              </Banner>
            )}
            {importResult && (
              <Banner
                tone={
                  importResult.errors && (importResult.errors as string[]).length > 0
                    ? "warning"
                    : "success"
                }
              >
                <Text as="p">
                  Imported <strong>{importResult.imported as number}</strong> zip
                  codes.
                  {(importResult.skipped as number) > 0 &&
                    ` Skipped ${importResult.skipped} entries.`}
                </Text>
                {importResult.errors &&
                  (importResult.errors as string[]).map((e, i) => (
                    <Text as="p" key={i} tone="critical">
                      {e}
                    </Text>
                  ))}
              </Banner>
            )}

            <Text as="p" variant="bodyMd">
              Upload a CSV file or paste CSV data below. The expected format is:
            </Text>
            <Box
              padding="300"
              background="bg-surface-secondary"
              borderRadius="200"
            >
              <Text as="p" variant="bodySm" fontWeight="semibold">
                Zip Code, Zone, Status, Message, ETA, COD, Return Policy
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                10001, Manhattan, allowed, Delivery available!, 2-3 days, Yes, 30-day returns
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                33101, Miami, blocked, Sorry we don&apos;t deliver here,,No,
              </Text>
            </Box>

            <BlockStack gap="300">
              <InlineStack align="end">
                <Button
                  variant="plain"
                  icon={ExportIcon}
                  onClick={downloadSampleCsv}
                >
                  Download Sample CSV
                </Button>
              </InlineStack>

              <DropZone
                accept=".csv,text/csv"
                type="file"
                onDrop={handleFileUpload}
                allowMultiple={false}
              >
                {importFile ? (
                  <Box padding="400">
                    <InlineStack gap="200" blockAlign="center" align="center">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {importFile.name}
                      </Text>
                      <Badge tone="success">Ready</Badge>
                    </InlineStack>
                  </Box>
                ) : (
                  <DropZone.FileUpload actionHint="Accepts .csv files" />
                )}
              </DropZone>
            </BlockStack>

            <Text as="p" variant="bodySm" tone="subdued">
              Or paste your CSV data directly:
            </Text>
            <TextField
              label="CSV data"
              labelHidden
              value={csvText}
              onChange={setCsvText}
              multiline={6}
              placeholder="10001, Manhattan, allowed, Delivery available!, 2-3 days"
              autoComplete="off"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Range Import Modal */}
      <Modal
        open={rangeModalOpen}
        onClose={() => {
          setRangeModalOpen(false);
          setRangeStart("");
          setRangeEnd("");
          setRangeZone("");
          setRangeType("allowed");
          setRangeMessage("");
          setRangeEta("");
        }}
        title="Import ZIP Code Range"
        primaryAction={{
          content: isRangeLoading ? "Importing..." : "Import Range",
          onAction: handleRangeImport,
          loading: isRangeLoading,
          disabled: !rangeStart.trim() || !rangeEnd.trim(),
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => {
              setRangeModalOpen(false);
              setRangeStart("");
              setRangeEnd("");
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {rangeResult && (
              <Banner tone={"error" in rangeResult ? "critical" : "success"}>
                {"error" in rangeResult ? (
                  <Text as="p">{(rangeResult as unknown as { error: string }).error}</Text>
                ) : (
                  <Text as="p">
                    Imported <strong>{rangeResult.imported as number}</strong> zip codes
                    ({rangeResult.total as number} in range).
                  </Text>
                )}
              </Banner>
            )}
            <Text as="p" variant="bodyMd">
              Enter a numeric ZIP code range to bulk-import up to 500 zip codes at once.
              Only 5-digit US ZIP codes are supported.
            </Text>
            <InlineGrid columns={2} gap="300">
              <TextField
                label="Start ZIP"
                value={rangeStart}
                onChange={setRangeStart}
                placeholder="10001"
                autoComplete="off"
                maxLength={5}
              />
              <TextField
                label="End ZIP"
                value={rangeEnd}
                onChange={setRangeEnd}
                placeholder="10099"
                autoComplete="off"
                maxLength={5}
              />
            </InlineGrid>
            <Select
              label="Status"
              options={typeOptions}
              value={rangeType}
              onChange={setRangeType}
            />
            <TextField
              label="Zone (optional)"
              value={rangeZone}
              onChange={setRangeZone}
              placeholder="Manhattan"
              autoComplete="off"
              helpText="Group these ZIP codes under a zone name."
            />
            <TextField
              label="Delivery Message (optional)"
              value={rangeMessage}
              onChange={setRangeMessage}
              placeholder="We deliver to your area!"
              autoComplete="off"
            />
            <TextField
              label="ETA (optional)"
              value={rangeEta}
              onChange={setRangeEta}
              placeholder="2-3 business days"
              autoComplete="off"
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

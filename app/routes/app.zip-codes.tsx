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
  IndexTable,
  type IndexTableProps,
  Modal,
  Select,
  Divider,
  EmptyState,
  Box,
  Icon,
  Tooltip,
  DropZone,
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
    const zipCode = String(formData.get("zipCode") ?? "").trim().toUpperCase();
    const label = String(formData.get("label") || "").trim();
    const zone = String(formData.get("zone") || "").trim();
    const message = String(formData.get("message") || "").trim();
    const eta = String(formData.get("eta") || "").trim();
    // Sanitize type — only accept known values, default to "allowed"
    const rawType = String(formData.get("type") || "");
    const type = rawType === "blocked" ? "blocked" : "allowed";
    const codAvailable =
      formData.get("codAvailable") === "true"
        ? true
        : formData.get("codAvailable") === "false"
          ? false
          : null;
    const returnPolicy = (formData.get("returnPolicy") as string | null) || null;

    if (!zipCode) return { error: "Zip code is required." };

    try {
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
    } catch (err) {
      // P2002 = unique constraint violation (duplicate zip code)
      const code = (err as { code?: string }).code;
      if (code === "P2002") {
        return { error: `Zip code "${zipCode}" already exists.` };
      }
      return { error: "Failed to add zip code. Please try again." };
    }
  }

  if (intent === "delete") {
    const id = String(formData.get("id") ?? "");
    if (!id) return { error: "Missing zip code ID." };
    try {
      const existing = await db.zipCode.findFirst({ where: { id, shop } });
      if (!existing) return { error: "Zip code not found." };
      // Delete scoped to both id and shop for defense-in-depth
      await db.zipCode.delete({ where: { id: existing.id } });
      return { success: true, action: "deleted" };
    } catch {
      return { error: "Failed to delete zip code." };
    }
  }

  if (intent === "update") {
    const id = String(formData.get("id") ?? "");
    const zipCode = String(formData.get("zipCode") ?? "").trim().toUpperCase();
    const label = String(formData.get("label") || "").trim();
    const zone = String(formData.get("zone") || "").trim();
    const message = String(formData.get("message") || "").trim();
    const eta = String(formData.get("eta") || "").trim();
    // Sanitize type — only accept known values, default to "allowed"
    const rawType = String(formData.get("type") || "");
    const type = rawType === "blocked" ? "blocked" : "allowed";
    const isActive = formData.get("isActive") === "true";
    const codAvailable =
      formData.get("codAvailable") === "true"
        ? true
        : formData.get("codAvailable") === "false"
          ? false
          : null;
    const returnPolicy = (formData.get("returnPolicy") as string | null) || null;

    if (!id) return { error: "Missing zip code ID." };
    if (!zipCode) return { error: "Zip code is required." };

    try {
      const existing = await db.zipCode.findFirst({ where: { id, shop } });
      if (!existing) return { error: "Zip code not found." };
      // Update scoped to verified id+shop record
      await db.zipCode.update({
        where: { id: existing.id },
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
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") {
        return { error: `Zip code "${zipCode}" already exists.` };
      }
      return { error: `Failed to update zip code "${zipCode}". Please try again.` };
    }
  }

  if (intent === "toggle") {
    const id = String(formData.get("id") ?? "");
    if (!id) return { error: "Missing zip code ID." };
    const isActive = formData.get("isActive") === "true";
    try {
      const existing = await db.zipCode.findFirst({ where: { id, shop } });
      if (!existing) return { error: "Zip code not found." };
      // Update scoped to verified id+shop record
      await db.zipCode.update({
        where: { id: existing.id },
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

    try {
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
        const zipCode = (cols[0] || "").toUpperCase().trim();
        if (!zipCode) continue;

        const zone = cols[1] || null;
        // Sanitize: only "blocked" is accepted as an alternative to "allowed"
        const type = (cols[2] || "").toLowerCase().trim() === "blocked" ? "blocked" : "allowed";
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
    } catch {
      return { error: "Failed to import zip codes. Please try again." };
    }
  }

  if (intent === "export") {
    try {
      const subscription = await getShopSubscription(shop);
      const limits = PLAN_LIMITS[subscription.planTier];

      if (!limits.csvExport) {
        return {
          error: `CSV export is not available on the ${limits.label} plan. Upgrade to Pro or Ultimate to export your zip codes.`,
          upgradeRequired: true,
        };
      }

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

  if (intent === "bulk-delete") {
    const idsRaw = String(formData.get("ids") || "");
    const ids = idsRaw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (ids.length === 0) return { error: "No zip codes selected." };

    // Guard: cap to a reasonable max to prevent abuse
    if (ids.length > 5000) {
      return { error: "Too many zip codes selected at once. Please select fewer than 5000." };
    }

    try {
      // Delete only records that belong to this shop — always shop-scoped.
      // We do NOT reject if some IDs are missing (race condition / already deleted)
      // — instead we report how many were actually deleted.
      const result = await db.zipCode.deleteMany({
        where: { id: { in: ids }, shop },
      });
      return { success: true, action: "bulk-delete", deleted: result.count };
    } catch {
      return { error: "Failed to delete selected zip codes." };
    }
  }

  if (intent === "bulk-type-change") {
    const idsRaw = String(formData.get("ids") || "");
    const ids = idsRaw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    // Sanitize type — only accept known values
    const rawType = String(formData.get("type") || "");
    const type = rawType === "blocked" ? "blocked" : "allowed";

    if (ids.length === 0) return { error: "No zip codes selected." };
    if (ids.length > 5000) {
      return { error: "Too many zip codes selected at once. Please select fewer than 5000." };
    }

    try {
      const subscription = await getShopSubscription(shop);
      const limits = PLAN_LIMITS[subscription.planTier];

      if (type === "blocked" && !limits.allowBlocked) {
        return {
          error:
            "Blocked zip codes are not available on your current plan. Upgrade to Starter or higher to use blocked zip codes.",
          upgradeRequired: true,
        };
      }

      const result = await db.zipCode.updateMany({
        where: { id: { in: ids }, shop },
        data: { type },
      });
      return { success: true, action: "bulk-type-change", updated: result.count, type };
    } catch {
      return { error: `Failed to set zip codes to ${type}.` };
    }
  }

  if (intent === "bulk-activate") {
    const idsRaw = String(formData.get("ids") || "");
    const ids = idsRaw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const isActive = formData.get("isActive") === "true";

    if (ids.length === 0) return { error: "No zip codes selected." };
    if (ids.length > 5000) {
      return { error: "Too many zip codes selected at once. Please select fewer than 5000." };
    }

    try {
      const result = await db.zipCode.updateMany({
        where: { id: { in: ids }, shop },
        data: { isActive },
      });
      return { success: true, action: "bulk-activate", updated: result.count, isActive };
    } catch {
      return { error: `Failed to ${isActive ? "activate" : "deactivate"} selected zip codes.` };
    }
  }

  if (intent === "range-import") {
    const startZip = String(formData.get("startZip") || "").trim().toUpperCase();
    const endZip = String(formData.get("endZip") || "").trim().toUpperCase();
    const zone = (formData.get("zone") as string | null) || null;
    // Sanitize type — only accept known values, default to "allowed"
    const type = String(formData.get("type") || "") === "blocked" ? "blocked" : "allowed";
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

    try {
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

      // Build all zip records for the range
      const zipRecords = Array.from({ length: rangeSize }, (_, i) => ({
        shop,
        zipCode: String(start + i).padStart(5, "0"),
        zone: zone ?? undefined,
        type,
        message: message ?? undefined,
        eta: eta ?? undefined,
      }));

      // Use createMany with skipDuplicates — much faster than N sequential upserts.
      // For existing records (skipDuplicates), we do a follow-up updateMany to refresh
      // zone/type/message/eta so the import always reflects the submitted values.
      const created = await db.zipCode.createMany({
        data: zipRecords,
        skipDuplicates: true,
      });

      // Update any already-existing records in the range to apply the new values
      await db.zipCode.updateMany({
        where: {
          shop,
          zipCode: { in: zipRecords.map((r) => r.zipCode) },
        },
        data: {
          zone: zone ?? undefined,
          type,
          message: message ?? undefined,
          eta: eta ?? undefined,
        },
      });

      return { success: true, action: "range-import", imported: created.count, total: rangeSize };
    } catch {
      return { error: "Failed to import ZIP code range. Please try again." };
    }
  }

  // Unknown intent
  return { error: "Unknown action." };
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

export default function ZipCodesPage() {
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

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Whether the user has explicitly selected ALL items across all pages
  const [allSelected, setAllSelected] = useState(false);

  // Confirmation modal for single delete
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Confirmation modal for bulk delete
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState(false);

  const isCheckLoading =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "check";
  const isAddLoading =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "add";
  const isEditLoading =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "update";
  const isImportLoading =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "bulk-import";
  const isDeleteLoading =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "delete";
  const isBulkDeleteLoading =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "bulk-delete";
  const isBulkTypeChangeLoading =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "bulk-type-change";
  const isBulkActivateLoading =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "bulk-activate";

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

  // Scope errors to the modal that submitted the action so errors from one
  // modal cannot bleed into another. We track the last submitted intent and
  // only surface the error inside the matching modal.
  const lastSubmittedIntent = fetcher.formData?.get("intent") as string | undefined;
  const addModalError = actionError && lastSubmittedIntent === "add" ? actionError : null;
  const editModalError = actionError && lastSubmittedIntent === "update" ? actionError : null;
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

  // Reset to page 1 and clear selection when search/filter changes
  const handleSearchChange = useCallback((val: string) => {
    setSearchQuery(val);
    setCurrentPage(1);
    setSelectedIds([]);
    setAllSelected(false);
  }, []);

  const handleFilterChange = useCallback((val: string) => {
    setStatusFilter(val);
    setCurrentPage(1);
    setSelectedIds([]);
    setAllSelected(false);
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
    // Close/reset is handled in useEffect after server confirms success
  }, [newZip, newLabel, newZone, newMessage, newEta, newType, newCodAvailable, newReturnPolicy, fetcher]);

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
    // Close/toast handled in useEffect after server confirms success
  }, [editId, editZip, editLabel, editZone, editMessage, editEta, editType, editIsActive, editCodAvailable, editReturnPolicy, fetcher]);

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

  const handleSelectionChange = useCallback<NonNullable<IndexTableProps["onSelectionChange"]>>(
    (selectionType, isSelecting, selection) => {
      if (selectionType === "all") {
        // "Select all X items" banner was clicked — select every item across all pages
        setSelectedIds(isSelecting ? filteredZipCodes.map((z) => z.id) : []);
        setAllSelected(isSelecting);
      } else if (selectionType === "page") {
        // Page-level checkbox toggled
        const pageIds = paginatedZipCodes.map((z) => z.id);
        setSelectedIds((prev) => {
          if (isSelecting) {
            const merged = Array.from(new Set([...prev, ...pageIds]));
            return merged;
          }
          return prev.filter((id) => !pageIds.includes(id));
        });
        // If deselecting a page, we are no longer in "all selected" state
        if (!isSelecting) setAllSelected(false);
      } else if (typeof selection === "string") {
        // Single row checkbox toggled
        setSelectedIds((prev) =>
          isSelecting ? [...prev, selection] : prev.filter((id) => id !== selection),
        );
        // Deselecting any single row means we're no longer in "all selected" state
        if (!isSelecting) setAllSelected(false);
      }
    },
    [filteredZipCodes, paginatedZipCodes],
  );

  const handleBulkDeleteConfirm = useCallback(() => {
    if (selectedIds.length === 0) return;
    const fd = new FormData();
    fd.set("intent", "bulk-delete");
    fd.set("ids", selectedIds.join(","));
    fetcher.submit(fd, { method: "POST" });
    setConfirmBulkDeleteOpen(false);
  }, [selectedIds, fetcher]);

  const handleBulkTypeChange = useCallback(
    (type: "allowed" | "blocked") => {
      if (selectedIds.length === 0) return;
      const fd = new FormData();
      fd.set("intent", "bulk-type-change");
      fd.set("ids", selectedIds.join(","));
      fd.set("type", type);
      fetcher.submit(fd, { method: "POST" });
    },
    [selectedIds, fetcher],
  );

  const handleBulkActivate = useCallback(
    (isActive: boolean) => {
      if (selectedIds.length === 0) return;
      const fd = new FormData();
      fd.set("intent", "bulk-activate");
      fd.set("ids", selectedIds.join(","));
      fd.set("isActive", String(isActive));
      fetcher.submit(fd, { method: "POST" });
    },
    [selectedIds, fetcher],
  );

  // React to server responses — show toasts, close modals, clear selection.
  // All feedback is driven from here so it only fires after server confirmation.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;

    if ("success" in fetcher.data && fetcher.data.success) {
      const fetcherAction =
        "action" in fetcher.data ? (fetcher.data.action as string) : "";

      if (fetcherAction === "added") {
        shopify.toast.show("Zip code added");
        setAddModalOpen(false);
        setNewZip("");
        setNewLabel("");
        setNewZone("");
        setNewMessage("");
        setNewEta("");
        setNewType("allowed");
        setNewCodAvailable("");
        setNewReturnPolicy("");
      } else if (fetcherAction === "updated") {
        shopify.toast.show("Zip code updated");
        setEditModalOpen(false);
      } else if (fetcherAction === "deleted") {
        shopify.toast.show("Zip code removed");
      } else if (fetcherAction === "toggled") {
        shopify.toast.show("Zip code status updated");
      } else if (fetcherAction === "bulk-delete") {
        const deleted =
          "deleted" in fetcher.data ? (fetcher.data.deleted as number) : selectedIds.length;
        shopify.toast.show(
          `${deleted} zip code${deleted !== 1 ? "s" : ""} deleted`,
        );
        setSelectedIds([]);
        setAllSelected(false);
      } else if (fetcherAction === "bulk-type-change") {
        const updated =
          "updated" in fetcher.data ? (fetcher.data.updated as number) : selectedIds.length;
        const bulkType =
          "type" in fetcher.data ? (fetcher.data.type as string) : "allowed";
        shopify.toast.show(
          `${updated} zip code${updated !== 1 ? "s" : ""} set to ${bulkType}`,
        );
        setSelectedIds([]);
        setAllSelected(false);
      } else if (fetcherAction === "bulk-activate") {
        const updated =
          "updated" in fetcher.data ? (fetcher.data.updated as number) : selectedIds.length;
        const active =
          "isActive" in fetcher.data ? (fetcher.data.isActive as boolean) : true;
        shopify.toast.show(
          `${updated} zip code${updated !== 1 ? "s" : ""} ${active ? "activated" : "deactivated"}`,
        );
        setSelectedIds([]);
        setAllSelected(false);
      }
    }
  }, [fetcher.state, fetcher.data, shopify, selectedIds.length]);

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

  const promotedBulkActions = [
    {
      content: "Set Allowed",
      onAction: () => handleBulkTypeChange("allowed"),
    },
    ...(limits.allowBlocked
      ? [
          {
            content: "Set Blocked",
            onAction: () => handleBulkTypeChange("blocked"),
          },
        ]
      : []),
    {
      content: "Activate",
      onAction: () => handleBulkActivate(true),
    },
    {
      content: "Deactivate",
      onAction: () => handleBulkActivate(false),
    },
    {
      content: "Delete Selected",
      onAction: () => setConfirmBulkDeleteOpen(true),
      destructive: true,
    },
  ];

  return (
    <Page
      title="Pinzo"
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
        {/* Zip limit reached — takes priority over general upgrade nudge */}
        {atZipLimit && (
          <Layout.Section>
            <Banner
              title="Zip code limit reached"
              tone="warning"
              action={{
                content: `Upgrade to ${isFreePlan ? "Starter" : "Pro"}`,
                url: "/app/pricing",
              }}
            >
              <Text as="p" variant="bodyMd">
                You have reached the {limits.maxZipCodes} zip code limit on the{" "}
                {limits.label} plan. Upgrade to{" "}
                {isFreePlan ? "Starter" : "Pro"} for a higher limit.
                {isFreePlan
                  ? " Starter unlocks 500 zip codes and CSV import. Pro unlocks unlimited zip codes, blocked zones, and CSV export."
                  : " Pro unlocks unlimited zip codes, blocked zones, CSV export, and delivery rules."}
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {/* General upgrade nudge — only shown when NOT at the limit */}
        {!atZipLimit && isFreePlan && (
          <Layout.Section>
            <Banner
              title="Unlock more zip codes, blocked zones & CSV tools"
              tone="info"
              action={{
                content: "View Plans",
                url: "/app/pricing",
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

        {/* Upgrade banner for starter plan — only shown when NOT at the limit */}
        {!atZipLimit && isStarterPlan && (
          <Layout.Section>
            <Banner
              title="Unlock unlimited zip codes, blocked zones & CSV export"
              tone="info"
              action={{
                content: "View Plans",
                url: "/app/pricing",
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
              <BlockStack gap="150" inlineAlign="start">
                <Text as="p" tone="subdued" variant="bodySm">
                  Current Plan
                </Text>
                {subscription.planTier === "ultimate" ? (
                  <Badge tone="success">Ultimate Plan</Badge>
                ) : subscription.planTier === "pro" ? (
                  <Badge tone="info">Pro Plan</Badge>
                ) : subscription.planTier === "starter" ? (
                  <Badge tone="warning">Starter Plan</Badge>
                ) : (
                  <Badge tone="info">Free Plan</Badge>
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

        {/* Pinzo Tool */}
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
                      <Text as="span" fontWeight="semibold">{checkResult.zipCode}</Text> is{" "}
                      <Text as="span" fontWeight="semibold">not found</Text> in your zip code list.
                    </Text>
                  ) : checkResult.record?.type === "allowed" ? (
                    <Text as="p">
                      <Text as="span" fontWeight="semibold">{checkResult.zipCode}</Text> is{" "}
                      <Text as="span" fontWeight="semibold">allowed</Text>
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
                        <Text as="span" tone="subdued">(Currently inactive)</Text>
                      )}
                    </Text>
                  ) : (
                    <Text as="p">
                      <Text as="span" fontWeight="semibold">{checkResult.zipCode}</Text> is{" "}
                      <Text as="span" fontWeight="semibold">blocked</Text>
                      {checkResult.record?.zone
                        ? ` — Zone: ${checkResult.record.zone}`
                        : ""}
                      {checkResult.record?.message
                        ? ` — ${checkResult.record.message}`
                        : ""}
                      .{" "}
                      {!checkResult.record?.isActive && (
                        <Text as="span" tone="subdued">(Currently inactive)</Text>
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
                  <Box minWidth="260px">
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
                  </Box>
                  <Box minWidth="120px">
                    <Select
                      label="Filter"
                      labelHidden
                      options={filterOptions}
                      value={statusFilter}
                      onChange={handleFilterChange}
                    />
                  </Box>
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
                <Text as="p">
                  Add zip codes to control which areas are allowed or blocked
                  for your store. You can add them one by one or import a CSV
                  file.
                </Text>
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
                <IndexTable
                  itemCount={paginatedZipCodes.length}
                  selectedItemsCount={allSelected ? "All" : selectedIds.filter((id) => paginatedZipCodes.some((z) => z.id === id)).length}
                  onSelectionChange={handleSelectionChange}
                  resourceName={{ singular: "zip code", plural: "zip codes" }}
                  headings={[
                    { title: "Zip Code" },
                    { title: "Zone" },
                    { title: "Status" },
                    { title: "Message" },
                    { title: "ETA" },
                    { title: "COD" },
                    { title: "Actions" },
                  ]}
                  promotedBulkActions={promotedBulkActions}
                  loading={isBulkDeleteLoading || isBulkTypeChangeLoading || isBulkActivateLoading}
                  pagination={
                    totalPages > 1
                      ? {
                          hasPrevious: currentPage > 1,
                          onPrevious: () => setCurrentPage((p) => Math.max(1, p - 1)),
                          hasNext: currentPage < totalPages,
                          onNext: () => setCurrentPage((p) => Math.min(totalPages, p + 1)),
                          label: `Page ${currentPage} of ${totalPages} (${filteredZipCodes.length} results)`,
                        }
                      : undefined
                  }
                >
                  {paginatedZipCodes.map((z, index) => (
                    <IndexTable.Row
                      key={z.id}
                      id={z.id}
                      position={index}
                      selected={selectedIds.includes(z.id)}
                    >
                      <IndexTable.Cell>
                        <Text as="span" fontWeight="bold">
                          {z.zipCode}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        {z.zone || (
                          <Text as="span" tone="subdued">
                            —
                          </Text>
                        )}
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <InlineStack gap="300" blockAlign="center">
                          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                          <div onClick={(e) => e.stopPropagation()}>
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
                          </div>
                          <Badge tone={z.type === "allowed" ? "success" : "critical"}>
                            {z.type === "allowed" ? "Allow" : "Block"}
                          </Badge>
                        </InlineStack>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        {z.message || (
                          <Text as="span" tone="subdued">
                            —
                          </Text>
                        )}
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        {z.eta || (
                          <Text as="span" tone="subdued">
                            —
                          </Text>
                        )}
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        {z.codAvailable === true ? (
                          <Badge tone="success">COD</Badge>
                        ) : z.codAvailable === false ? (
                          <Badge tone="critical">No COD</Badge>
                        ) : (
                          <Text as="span" tone="subdued">
                            —
                          </Text>
                        )}
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                        <div onClick={(e) => e.stopPropagation()}>
                        <InlineStack gap="200" blockAlign="center">
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
                        </InlineStack>
                        </div>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
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
            {addModalError && (
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
                {addModalError}
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
              <Box minWidth="0" width="100%">
                <TextField
                  label="Zone"
                  value={newZone}
                  onChange={setNewZone}
                  placeholder="e.g. Manhattan, Beverly Hills"
                  autoComplete="off"
                  helpText="The delivery zone or area name."
                />
              </Box>
              <Box minWidth="0" width="100%">
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
              </Box>
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
              <Box minWidth="0" width="100%">
                <TextField
                  label="ETA"
                  value={newEta}
                  onChange={setNewEta}
                  placeholder="e.g. 2-3 days"
                  autoComplete="off"
                  helpText="Estimated delivery time."
                />
              </Box>
              <Box minWidth="0" width="100%">
                <TextField
                  label="Label (optional)"
                  value={newLabel}
                  onChange={setNewLabel}
                  placeholder="e.g. Downtown LA"
                  autoComplete="off"
                  helpText="Internal label for your reference."
                />
              </Box>
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

      {/* Edit Zip Code Modal
          key={editId || 'new'} forces React to remount the modal DOM when
          switching between different ZIP code records, preventing stale field
          values and flickering caused by React reusing the existing modal node. */}
      <Modal
        key={editId || "new"}
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
            {/* Reserve a stable min-height for the error slot so the form
                fields don't shift when the Banner appears or disappears. */}
            <div style={{ minHeight: editModalError ? undefined : 0 }}>
              {editModalError && (
                <Banner tone="critical">{editModalError}</Banner>
              )}
            </div>
            <TextField
              label="Zip Code"
              value={editZip}
              onChange={setEditZip}
              placeholder="e.g. 90210"
              autoComplete="off"
              helpText="Enter a 5-digit US zip code or postal code."
            />
            <InlineStack gap="300">
              <Box minWidth="0" width="100%">
                <TextField
                  label="Zone"
                  value={editZone}
                  onChange={setEditZone}
                  placeholder="e.g. Manhattan, Beverly Hills"
                  autoComplete="off"
                  helpText="The delivery zone or area name."
                />
              </Box>
              <Box minWidth="0" width="100%">
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
              </Box>
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
              <Box minWidth="0" width="100%">
                <TextField
                  label="ETA"
                  value={editEta}
                  onChange={setEditEta}
                  placeholder="e.g. 2-3 days"
                  autoComplete="off"
                  helpText="Estimated delivery time."
                />
              </Box>
              <Box minWidth="0" width="100%">
                <TextField
                  label="Label (optional)"
                  value={editLabel}
                  onChange={setEditLabel}
                  placeholder="e.g. Downtown LA"
                  autoComplete="off"
                  helpText="Internal label for your reference."
                />
              </Box>
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
                  Imported <Text as="span" fontWeight="semibold">{importResult.imported as number}</Text> zip
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
                    Imported <Text as="span" fontWeight="semibold">{rangeResult.imported as number}</Text> zip codes
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

      {/* Single Delete Confirmation Modal */}
      <Modal
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        title="Delete zip code?"
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
            This will permanently remove this zip code. This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>

      {/* Bulk Delete Confirmation Modal */}
      <Modal
        open={confirmBulkDeleteOpen}
        onClose={() => setConfirmBulkDeleteOpen(false)}
        title={`Delete ${selectedIds.length} zip code${selectedIds.length !== 1 ? "s" : ""}?`}
        primaryAction={{
          content: "Delete",
          onAction: handleBulkDeleteConfirm,
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
              {selectedIds.length} zip code{selectedIds.length !== 1 ? "s" : ""}
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

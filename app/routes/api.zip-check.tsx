/**
 * Public API endpoint for the storefront zip code widget.
 *
 * Called from the merchant's storefront (Theme App Extension or custom JS)
 * to check whether a zip code is serviceable.
 *
 * GET/POST /api/zip-check?shop=store.myshopify.com&zip=12345
 *
 * Response:
 *   200 { allowed: true,  message: "...", eta: "...", zone: "..." }
 *   200 { allowed: false, message: "..." }
 *   400 { error: "Missing shop or zip parameter" }
 *   404 { allowed: false, message: "Zip code not found", notFound: true }
 */
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { normalizeZipCode } from "../utils/zip";

function calculateDeliveryDate(
  estimatedDays: string,
  daysOfWeek: string | null,
): string | null {
  const match = estimatedDays.match(/^(\d+)/);
  if (!match) return null;
  const minDays = parseInt(match[1], 10);
  if (isNaN(minDays) || minDays < 0) return null;

  const deliveryDayNames = daysOfWeek
    ? daysOfWeek.split(",").map((d) => d.trim().toLowerCase())
    : ["mon", "tue", "wed", "thu", "fri"];

  const dayMap: Record<string, number> = {
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  };
  const deliveryDayNumbers = new Set(
    deliveryDayNames.map((d) => dayMap[d]).filter((n) => n !== undefined),
  );

  if (deliveryDayNumbers.size === 0) {
    [1, 2, 3, 4, 5].forEach((d) => deliveryDayNumbers.add(d));
  }

  const date = new Date();
  let businessDaysAdded = 0;

  while (businessDaysAdded < minDays) {
    date.setDate(date.getDate() + 1);
    if (deliveryDayNumbers.has(date.getDay())) {
      businessDaysAdded++;
    }
  }

  while (!deliveryDayNumbers.has(date.getDay())) {
    date.setDate(date.getDate() + 1);
  }

  return date.toISOString().split("T")[0];
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// Applied only to successful (allowed) ZIP check responses to reduce DB load
// for repeated lookups of the same ZIP code from the same storefront visitor.
const SUCCESS_HEADERS = {
  ...CORS_HEADERS,
  "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
};

// Short cache for denied/not-found responses so merchants see changes quickly
// (e.g. when they add a new ZIP code it takes effect within 5 seconds).
const DENY_HEADERS = {
  ...CORS_HEADERS,
  "Cache-Control": "no-cache, max-age=5",
};

const SHOP_DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

async function handleZipCheck(shop: string | null, zip: string | null) {
  if (!shop || !zip) {
    return new Response(
      JSON.stringify({ error: "Missing shop or zip parameter" }),
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Validate shop is a real myshopify.com domain (prevents cross-shop enumeration)
  if (!SHOP_DOMAIN_RE.test(shop) || shop.length > 100) {
    return new Response(
      JSON.stringify({ error: "Invalid shop parameter" }),
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Enforce input length limits to prevent abuse
  if (zip.length > 20) {
    return new Response(
      JSON.stringify({ error: "Invalid zip code" }),
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const normalizedZip = normalizeZipCode(zip);

  try {
  const zipRecord = await db.zipCode.findUnique({
    where: { shop_zipCode: { shop, zipCode: normalizedZip } },
  });

  // Fetch widget config for custom messages (falls back to defaults)
  const widgetConfig = await db.widgetConfig.findUnique({ where: { shop } });

  // Fetch shop settings to determine default behavior for unlisted zip codes
  const shopSettings = await db.shopSettings.findUnique({ where: { shop } });
  const defaultBehavior = shopSettings?.defaultBehavior ?? "block";

  if (!zipRecord || !zipRecord.isActive) {
    const notFoundMsg =
      widgetConfig?.notFoundMessage ??
      "We currently do not ship to this ZIP code.";

    // If the zip is simply not in the list (not inactive) and the merchant
    // has set defaultBehavior to "allow", treat it as an allowed zip
    if (!zipRecord && defaultBehavior === "allow") {
      const successMsg =
        widgetConfig?.successMessage ?? "We deliver to your area!";
      return new Response(
        JSON.stringify({
          allowed: true,
          message: successMsg,
          eta: null,
          zone: null,
          codAvailable: null,
          returnPolicy: null,
          showWaitlist: false,
          waitlistCount: 0,
          cutoffTime: null,
          daysOfWeek: null,
        }),
        { status: 200, headers: SUCCESS_HEADERS },
      );
    }

    // Social proof: count how many customers are waiting for this ZIP
    let waitlistCount = 0;
    try {
      waitlistCount = await db.waitlistEntry.count({
        where: { shop, zipCode: normalizedZip, status: "waiting" },
      });
    } catch {
      waitlistCount = 0;
    }

    if (!zipRecord) {
      return new Response(
        JSON.stringify({
          allowed: false,
          message: notFoundMsg,
          notFound: true,
          showWaitlist: widgetConfig?.showWaitlistOnFailure ?? false,
          waitlistCount,
        }),
        { status: 200, headers: DENY_HEADERS },
      );
    }

    // Inactive zip — treat same as not found regardless of defaultBehavior
    return new Response(
      JSON.stringify({
        allowed: false,
        message: notFoundMsg,
        notFound: true,
        showWaitlist: widgetConfig?.showWaitlistOnFailure ?? false,
        waitlistCount,
      }),
      { status: 200, headers: DENY_HEADERS },
    );
  }

  if (zipRecord.type === "blocked") {
    const errorMsg =
      zipRecord.message ??
      widgetConfig?.errorMessage ??
      "Sorry, we don't deliver to this area yet.";

    // Social proof: count how many customers are waiting for this ZIP
    let waitlistCount = 0;
    try {
      waitlistCount = await db.waitlistEntry.count({
        where: { shop, zipCode: normalizedZip, status: "waiting" },
      });
    } catch {
      waitlistCount = 0;
    }

    return new Response(
      JSON.stringify({
        allowed: false,
        message: errorMsg,
        showWaitlist: widgetConfig?.showWaitlistOnFailure ?? false,
        waitlistCount,
      }),
      { status: 200, headers: DENY_HEADERS },
    );
  }

  // Fetch the most relevant active DeliveryRule for this zip.
  // Priority 1: rules that explicitly list this zip in their zipCodes field.
  // Priority 2: rules that match by zone (with no explicit zip list).
  // Within each priority tier, order by `priority ASC` (lower = higher priority).
  const zipCodeUpper = normalizedZip;
  const zipZone = zipRecord.zone ?? null;

  // Fetch all active rules for the shop ordered by priority so we can apply
  // the matching logic in a single query result.
  const activeRules = await db.deliveryRule.findMany({
    where: { shop, isActive: true },
    orderBy: { priority: "asc" },
  });

  let matchedRule: (typeof activeRules)[number] | null = null;

  // Pass 1: explicit zip match — zipCodes field contains this zip code
  for (const rule of activeRules) {
    if (rule.zipCodes) {
      const zips = rule.zipCodes.split(",").map((z) => z.trim().toUpperCase());
      if (zips.includes(zipCodeUpper)) {
        matchedRule = rule;
        break;
      }
    }
  }

  // Pass 2: zone match — rule's zone matches the zip's zone and no explicit zip list
  if (!matchedRule && zipZone) {
    for (const rule of activeRules) {
      if (
        rule.zone === zipZone &&
        (!rule.zipCodes || rule.zipCodes.trim() === "")
      ) {
        matchedRule = rule;
        break;
      }
    }
  }

  // Allowed
  const successMsg =
    zipRecord.message ??
    widgetConfig?.successMessage ??
    "Great news! We deliver to your area.";

  // ETA: prefer the zip-level eta, then fall back to the matched delivery rule's
  // estimatedDays so merchants only need to populate one place.
  const etaValue = zipRecord.eta ?? matchedRule?.estimatedDays ?? null;

  const estimatedDeliveryDate =
    widgetConfig?.showDeliveryDate !== false && etaValue
      ? calculateDeliveryDate(etaValue, matchedRule?.daysOfWeek ?? null)
      : null;

  const deliveryFeeValue =
    widgetConfig?.showDeliveryFee !== false
      ? (matchedRule?.deliveryFee ?? null)
      : null;
  const freeShippingAboveValue =
    widgetConfig?.showDeliveryFee !== false
      ? (matchedRule?.freeShippingAbove ?? null)
      : null;

  return new Response(
    JSON.stringify({
      allowed: true,
      message: successMsg,
      eta: widgetConfig?.showEta ? etaValue : null,
      zone: widgetConfig?.showZone ? (zipRecord.zone ?? null) : null,
      codAvailable: widgetConfig?.showCod !== false ? (zipRecord.codAvailable ?? null) : null,
      returnPolicy: widgetConfig?.showReturnPolicy !== false ? (zipRecord.returnPolicy ?? null) : null,
      showWaitlist: false,
      waitlistCount: 0,
      cutoffTime: widgetConfig?.showCutoffTime !== false ? (matchedRule?.cutoffTime ?? null) : null,
      daysOfWeek: widgetConfig?.showDeliveryDays !== false ? (matchedRule?.daysOfWeek ?? null) : null,
      estimatedDeliveryDate,
      deliveryFee: deliveryFeeValue,
      freeShippingAbove: freeShippingAboveValue,
    }),
    { status: 200, headers: SUCCESS_HEADERS },
  );
  } catch (err) {
    console.error("[api.zip-check] Unhandled error for shop=%s zip=%s:", shop, zip, err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

// Handle GET requests: ?shop=...&zip=...
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const shop = url.searchParams.get("shop");
  const zip = url.searchParams.get("zip");
  return handleZipCheck(shop, zip);
};

// Handle POST requests with JSON body: { shop, zip }
export const action = async ({ request }: ActionFunctionArgs) => {
  let shop: string | null = null;
  let zip: string | null = null;

  try {
    const body = await request.json();
    shop = body?.shop ?? null;
    zip = body?.zip ?? null;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  return handleZipCheck(shop, zip);
};

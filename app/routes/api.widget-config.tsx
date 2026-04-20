/**
 * Public API endpoint — serves widget configuration for the storefront block.
 *
 * Called from the theme app extension block JS to get the merchant's
 * widget styling and text settings.
 *
 * GET /api/widget-config?shop=store.myshopify.com
 *
 * Response: WidgetConfig JSON (falls back to defaults if no config found)
 */
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { getShopSubscription } from "../billing.server";
import { rateLimit, getClientIp, rateLimitResponse } from "../utils/rate-limit.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const DEFAULTS = {
  position: "inline",
  primaryColor: "#008060",
  successColor: "#008060",
  errorColor: "#D72C0D",
  backgroundColor: "#FFFFFF",
  textColor: "#202223",
  heading: "Check Delivery Availability",
  placeholder: "Enter your zip code",
  buttonText: "Check",
  successMessage: "Great news! We deliver to your area.",
  errorMessage: "Sorry, we don't deliver to this area yet.",
  notFoundMessage: "We currently do not ship to this ZIP code.",
  showEta: true,
  showZone: false,
  showWaitlistOnFailure: false,
  showCod: true,
  showReturnPolicy: true,
  showCutoffTime: true,
  showDeliveryDays: true,
  showDeliveryDate: true,
  showCountdown: true,
  showDeliveryFee: true,
  blockCartOnInvalid: false,
  blockCheckoutInCart: false,
  showSocialProof: true,
  lockButtonsUntilZipCheck: true,
  waitlistTitle: "Get notified when we deliver to your area",
  waitlistButtonText: "Notify Me",
  borderRadius: "8",
  customCss: null as string | null,
};

/**
 * Sanitize merchant-supplied custom CSS before embedding it in a storefront
 * <style> element. Strips known injection vectors and layout-hijack at-rules.
 */
const CSS_MAX_LENGTH = 10_000;

function sanitizeCss(css: string): string {
  const trimmed = css.length > CSS_MAX_LENGTH ? css.slice(0, CSS_MAX_LENGTH) : css;
  return trimmed
    // Break out of <style> blocks — strip both opening and closing tags
    .replace(/<style\b[^>]*>/gi, "")
    .replace(/<\/style>/gi, "")
    // External stylesheet loading
    .replace(/@import\b[^;]*(;|$)/gi, "")
    // At-rules that can target arbitrary storefront elements and break layout
    // (e.g. @media(prefers-color-scheme: dark) { body { display: none } })
    .replace(/@media\b[^{]*\{[\s\S]*?\}\s*\}/gi, "")
    .replace(/@supports\b[^{]*\{[\s\S]*?\}\s*\}/gi, "")
    .replace(/@keyframes\b[^{]*\{[\s\S]*?\}\s*\}/gi, "")
    .replace(/@font-face\b[^{]*\{[\s\S]*?\}/gi, "")
    // IE expression() — JS execution inside CSS property values
    .replace(/\bexpression\s*\(/gi, "")
    // Any remote url() — only allow same-origin/Shopify CDN (safer to strip all)
    .replace(/url\s*\(\s*['"]?\s*https?\s*:/gi, "url(")
    .replace(/url\s*\(\s*['"]?\s*javascript\s*:/gi, "url(")
    .replace(/url\s*\(\s*['"]?\s*data\s*:/gi, "url(")
    // Positioning that can cover the whole page/hijack clicks
    .replace(/position\s*:\s*fixed/gi, "position:static")
    .replace(/position\s*:\s*sticky/gi, "position:static");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Rate limit: 30 requests per IP per minute (config is cached on client side)
  const ip = getClientIp(request);
  const { limited, resetAt } = rateLimit(`widget-config:${ip}`, 30, 60_000);
  if (limited) return rateLimitResponse(resetAt, CORS_HEADERS);

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return new Response(
      JSON.stringify({ error: "Missing shop parameter" }),
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Validate shop is a real myshopify.com domain (prevents cross-shop config enumeration)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop) || shop.length > 100) {
    return new Response(
      JSON.stringify({ error: "Invalid shop parameter" }),
      { status: 400, headers: CORS_HEADERS },
    );
  }

  let config, subscription;
  try {
    [config, subscription] = await Promise.all([
      db.widgetConfig.findUnique({ where: { shop } }),
      getShopSubscription(shop),
    ]);
  } catch {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: CORS_HEADERS },
    );
  }

  const limits = subscription.limits;

  const raw = config
    ? {
        position: config.position,
        primaryColor: config.primaryColor,
        successColor: config.successColor,
        errorColor: config.errorColor,
        backgroundColor: config.backgroundColor,
        textColor: config.textColor,
        heading: config.heading,
        placeholder: config.placeholder,
        buttonText: config.buttonText,
        successMessage: config.successMessage,
        errorMessage: config.errorMessage,
        notFoundMessage: config.notFoundMessage,
        showEta: config.showEta,
        showZone: config.showZone,
        showWaitlistOnFailure: config.showWaitlistOnFailure,
        showCod: config.showCod ?? true,
        showReturnPolicy: config.showReturnPolicy ?? true,
        showCutoffTime: config.showCutoffTime ?? true,
        showDeliveryDays: config.showDeliveryDays ?? true,
        showDeliveryDate: config.showDeliveryDate ?? true,
        showCountdown: config.showCountdown ?? true,
        showDeliveryFee: config.showDeliveryFee ?? true,
        blockCartOnInvalid: config.blockCartOnInvalid ?? false,
        showSocialProof: config.showSocialProof ?? true,
        lockButtonsUntilZipCheck: config.lockButtonsUntilZipCheck ?? true,
        waitlistTitle: (config as unknown as { waitlistTitle?: string }).waitlistTitle ?? "Get notified when we deliver to your area",
        waitlistButtonText: (config as unknown as { waitlistButtonText?: string }).waitlistButtonText ?? "Notify Me",
        borderRadius: config.borderRadius,
        customCss: config.customCss ? sanitizeCss(config.customCss) : null,
      }
    : DEFAULTS;

  // Server-side enforcement: strip features the plan doesn't include
  const payload = {
    ...raw,
    // Free plan: reset colors to defaults (position is already "inline" in DB
    // for free-plan shops since the admin UI disables the position selector)
    ...(limits.widgetFullCustom
      ? {}
      : {
          primaryColor: DEFAULTS.primaryColor,
          successColor: DEFAULTS.successColor,
          errorColor: DEFAULTS.errorColor,
          backgroundColor: DEFAULTS.backgroundColor,
          textColor: DEFAULTS.textColor,
        }),
    // ETA/COD/Return policy toggles
    ...(limits.showEtaCodReturn ? {} : {
      showEta: false,
      showZone: false,
      showCod: false,
      showReturnPolicy: false,
      showCutoffTime: false,
      showDeliveryDays: false,
      showDeliveryDate: false,
      showCountdown: false,
      showDeliveryFee: false,
    }),
    // Cart blocking (blockCartOnInvalid is Pro+ only)
    // lockButtonsUntilZipCheck is available on ALL plans — it simply gates the
    // ATC button until the customer validates their ZIP in floating/popup mode.
    ...(limits.cartBlocking
      ? {}
      : { blockCartOnInvalid: false }),
    // Custom CSS
    ...(limits.customCss ? {} : { customCss: null }),
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      // Public, short-lived cache with SWR so storefront repeat visits don't
      // re-fetch config on every pageview. 5 min fresh + 15 min stale gives
      // merchants fast config propagation (<5 min worst case) without adding
      // 100–500 ms to every widget render.
      "Cache-Control": "public, max-age=300, stale-while-revalidate=900",
    },
  });
};

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
  borderRadius: "8",
  customCss: null as string | null,
};

/**
 * Sanitize merchant-supplied custom CSS before embedding it in a storefront
 * <style> element. Strips known injection vectors:
 *   - </style> close tags  — would break out of the enclosing style block
 *   - @import directives   — would load arbitrary external stylesheets
 *   - expression()         — IE-era JS-in-CSS execution vector
 *   - javascript: URLs     — covers url(javascript:...) and similar
 */
function sanitizeCss(css: string): string {
  return css
    // Break out of <style> blocks — strip both opening and closing tags
    .replace(/<style\b[^>]*>/gi, "")
    .replace(/<\/style>/gi, "")
    // External stylesheet loading
    .replace(/@import\b[^;]*(;|$)/gi, "")
    // IE expression() — JS execution inside CSS property values
    .replace(/\bexpression\s*\(/gi, "")
    // javascript: protocol inside url() references
    .replace(/url\s*\(\s*['"]?\s*javascript\s*:/gi, "url(")
    // data: URIs inside url() — can embed arbitrary content including scripts
    .replace(/url\s*\(\s*['"]?\s*data\s*:/gi, "url(");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

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
        blockCheckoutInCart: config.blockCheckoutInCart ?? false,
        showSocialProof: config.showSocialProof ?? true,
        lockButtonsUntilZipCheck: config.lockButtonsUntilZipCheck ?? true,
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
    // Cart blocking (blockCartOnInvalid + blockCheckoutInCart are Pro+ only)
    // lockButtonsUntilZipCheck is available on ALL plans — it simply gates the
    // ATC button until the customer validates their ZIP in floating/popup mode.
    ...(limits.cartBlocking
      ? {}
      : { blockCartOnInvalid: false, blockCheckoutInCart: false }),
    // Custom CSS
    ...(limits.customCss ? {} : { customCss: null }),
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
};

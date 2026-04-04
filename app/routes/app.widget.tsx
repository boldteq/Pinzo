import { useState, useCallback, useEffect, useMemo, memo } from "react";
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
import { PLAN_LIMITS } from "../plans";
import type { PlanTier } from "../plans";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Button,
  TextField,
  Checkbox,
  Divider,
  Box,
  Banner,
  Badge,
  Modal,
} from "@shopify/polaris";

/** Maximum length for custom CSS (characters). Prevents DB bloat and slow responses. */
const MAX_CUSTOM_CSS_LENGTH = 10_000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let config = await db.widgetConfig.findUnique({ where: { shop } });

  if (!config) {
    config = await db.widgetConfig.create({ data: { shop } });
  }

  const subscription = await getShopSubscription(shop);

  return { config, subscription };
};

// Helper: sync widget config to an App Installation metafield so the
// storefront Liquid block can read it via app.metafields.zip_checker.widget_config.value
//
// IMPORTANT: ownerId MUST be the App Installation GID (not the Shop GID).
// app.metafields in Liquid only surfaces metafields owned by the App Installation.
// Using the Shop GID writes to shop metafields which are invisible to app.metafields.
async function syncConfigMetafield(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  configData: Record<string, unknown>,
) {
  try {
    // Step 1: get the App Installation GID
    const installResponse = await admin.graphql(
      `query { currentAppInstallation { id } }`,
    );
    const installJson = (await installResponse.json()) as {
      data: { currentAppInstallation: { id: string } };
    };
    const appInstallationGid = installJson.data.currentAppInstallation.id;

    // Step 2: write the metafield to the App Installation
    // Namespace must be plain "zip_checker" (no "$app:" prefix) for App Installation metafields.
    // The Liquid block reads: app.metafields.zip_checker.widget_config.value
    const metaResponse = await admin.graphql(
      `mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id namespace key }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              ownerId: appInstallationGid,
              namespace: "zip_checker",
              key: "widget_config",
              type: "json",
              value: JSON.stringify(configData),
            },
          ],
        },
      },
    );
    await metaResponse.json();

    // userErrors are non-fatal — the API fallback still works
  } catch {
    // Non-fatal — the API fallback still works
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "save") {
      const data = {
        position: String(formData.get("position") || "inline"),
        primaryColor: String(formData.get("primaryColor") || "#008060"),
        successColor: String(formData.get("successColor") || "#008060"),
        errorColor: String(formData.get("errorColor") || "#D72C0D"),
        backgroundColor: String(formData.get("backgroundColor") || "#FFFFFF"),
        textColor: String(formData.get("textColor") || "#202223"),
        heading: String(formData.get("heading") || "Check Delivery Availability"),
        placeholder: String(formData.get("placeholder") || "Enter your zip code"),
        buttonText: String(formData.get("buttonText") || "Check"),
        successMessage: String(
          formData.get("successMessage") ||
            "Great news! We deliver to your area.",
        ),
        errorMessage: String(
          formData.get("errorMessage") ||
            "Sorry, we don't deliver to this area yet.",
        ),
        notFoundMessage: String(
          formData.get("notFoundMessage") ||
            "We currently do not ship to this ZIP code.",
        ),
        showEta: formData.get("showEta") === "true",
        showZone: formData.get("showZone") === "true",
        showWaitlistOnFailure: formData.get("showWaitlistOnFailure") === "true",
        showCod: formData.get("showCod") === "true",
        showReturnPolicy: formData.get("showReturnPolicy") === "true",
        showCutoffTime: formData.get("showCutoffTime") === "true",
        showDeliveryDays: formData.get("showDeliveryDays") === "true",
        showDeliveryDate: formData.get("showDeliveryDate") === "true",
        showCountdown: formData.get("showCountdown") === "true",
        showDeliveryFee: formData.get("showDeliveryFee") === "true",
        blockCartOnInvalid: formData.get("blockCartOnInvalid") === "true",
        blockCheckoutInCart: formData.get("blockCheckoutInCart") === "true",
        showSocialProof: formData.get("showSocialProof") === "true",
        lockButtonsUntilZipCheck: formData.get("lockButtonsUntilZipCheck") === "true",
        borderRadius: String(formData.get("borderRadius") || "8"),
        customCss: String(formData.get("customCss") || "").slice(0, MAX_CUSTOM_CSS_LENGTH) || null,
      };

      // Server-side plan gating: strip premium fields the shop's plan doesn't allow
      const subscription = await getShopSubscription(shop);
      const limits = PLAN_LIMITS[subscription.planTier];
      if (!limits.widgetFullCustom) {
        data.primaryColor = "#008060";
        data.successColor = "#008060";
        data.errorColor = "#D72C0D";
        data.backgroundColor = "#FFFFFF";
        data.textColor = "#202223";
        data.position = "inline";
      }
      if (!limits.showEtaCodReturn) {
        data.showEta = false;
        data.showZone = false;
        data.showCod = false;
        data.showReturnPolicy = false;
        data.showCutoffTime = false;
        data.showDeliveryDays = false;
        data.showDeliveryDate = false;
        data.showCountdown = false;
        data.showDeliveryFee = false;
      }
      if (!limits.customCss) {
        data.customCss = null;
      }
      if (!limits.cartBlocking) {
        data.blockCartOnInvalid = false;
        data.blockCheckoutInCart = false;
        // lockButtonsUntilZipCheck is allowed on all plans — do not strip it
      }

      await db.widgetConfig.upsert({
        where: { shop },
        create: { shop, ...data },
        update: data,
      });

      await syncConfigMetafield(admin, data);

      return { success: true };
    }

    if (intent === "reset") {
      const resetData = {
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
        customCss: null,
      };

      await db.widgetConfig.upsert({
        where: { shop },
        create: { shop },
        update: resetData,
      });

      await syncConfigMetafield(admin, resetData);

      return { success: true, action: "reset" };
    }

    return null;
  } catch {
    return new Response(JSON.stringify({ error: "Failed to save widget settings." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

type WidgetConfig = {
  position: string;
  primaryColor: string;
  successColor: string;
  errorColor: string;
  backgroundColor: string;
  textColor: string;
  heading: string;
  placeholder: string;
  buttonText: string;
  successMessage: string;
  errorMessage: string;
  notFoundMessage: string;
  showEta: boolean;
  showZone: boolean;
  showWaitlistOnFailure: boolean;
  showCod: boolean;
  showReturnPolicy: boolean;
  showCutoffTime: boolean;
  showDeliveryDays: boolean;
  showDeliveryDate: boolean;
  showCountdown: boolean;
  showDeliveryFee: boolean;
  blockCartOnInvalid: boolean;
  blockCheckoutInCart: boolean;
  showSocialProof: boolean;
  lockButtonsUntilZipCheck: boolean;
  borderRadius: string;
  customCss: string | null;
};

// ── Default widget configuration values ─────────────────────────────────────
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
  customCss: "",
};

// ── Scope custom CSS for admin preview — prefix selectors with #wid ─────────
// Handles @keyframes/@font-face (pass-through), @media (recursive scoping),
// and regular selectors (prefixed with container ID).
function scopeAdminCss(rawCss: string | null | undefined, wid: string): string {
  if (!rawCss) return "";
  // Sanitize the same way the public API does (mirrors api.widget-config.tsx)
  const css = rawCss
    .replace(/<style\b[^>]*>/gi, "")
    .replace(/<\/style>/gi, "")
    .replace(/@import\b[^;]*(;|$)/gi, "")
    .replace(/\bexpression\s*\(/gi, "")
    .replace(/url\s*\(\s*['"]?\s*javascript\s*:/gi, "url(")
    .replace(/url\s*\(\s*['"]?\s*data\s*:/gi, "url(");
  let result = "";
  let i = 0;
  while (i < css.length) {
    // Skip whitespace
    while (i < css.length && /\s/.test(css[i])) { result += css[i]; i++; }
    if (i >= css.length) break;
    // Handle at-rules
    if (css[i] === "@") {
      let atRule = "";
      let j = i;
      while (j < css.length && css[j] !== "{" && css[j] !== ";") { atRule += css[j]; j++; }
      const atName = atRule.trim().toLowerCase();
      // @keyframes and @font-face: pass through without scoping
      if (atName.startsWith("@keyframes") || atName.startsWith("@font-face")) {
        result += atRule;
        if (j < css.length && css[j] === "{") {
          let depth = 1; result += css[j]; j++;
          while (j < css.length && depth > 0) {
            if (css[j] === "{") depth++;
            if (css[j] === "}") depth--;
            result += css[j]; j++;
          }
        }
        i = j; continue;
      }
      // @media: recursively scope inner rules
      if (atName.startsWith("@media")) {
        result += atRule;
        if (j < css.length && css[j] === "{") {
          result += "{"; j++;
          let depth = 1; let inner = "";
          while (j < css.length && depth > 0) {
            if (css[j] === "{") depth++;
            if (css[j] === "}") depth--;
            if (depth > 0) inner += css[j];
            j++;
          }
          result += scopeAdminCss(inner, wid);
          result += "}";
        }
        i = j; continue;
      }
    }
    // Regular rule: grab selector, prefix with #wid
    let sel = "";
    let body = "";
    while (i < css.length && css[i] !== "{") { sel += css[i]; i++; }
    if (i < css.length) i++; // skip {
    let depth = 1;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      if (css[i] === "}") depth--;
      if (depth > 0) body += css[i];
      i++;
    }
    if (sel.trim()) {
      const prefixed = sel.split(",").map(s => {
        s = s.trim();
        return s ? "#" + wid + " " + s : "";
      }).filter(Boolean).join(", ");
      result += prefixed + " {" + body + "}";
    }
  }
  return result;
}

// ── CSS generators — one per style preset, mirrors the Liquid block CSS ─────

function buildSharedMetaCss(W: string, cfg: WidgetConfig): string {
  const s = cfg.successColor;
  return (
    // Result card layout — matches storefront
    W + " .zcc-result-icon{flex-shrink:0;width:20px;height:20px;display:flex;align-items:center;justify-content:center;box-sizing:content-box}" +
    W + " .zcc-result-icon svg{width:20px;height:20px;display:block}" +
    W + " .zcc-result-content{flex:1;min-width:0;margin:0;padding:0}" +
    W + " .zcc-result-message{font-weight:600;line-height:1.4;margin:0;padding:0}" +
    W + " .zcc-result.ok .zcc-result-icon{background:" + s + "15;border-radius:50%;padding:4px}" +
    W + " .zcc-result.ok .zcc-result-message{color:" + s + "}" +
    W + " .zcc-result.fail .zcc-result-icon{background:" + cfg.errorColor + "15;border-radius:50%;padding:4px}" +
    W + " .zcc-result.fail .zcc-result-message{color:" + cfg.errorColor + "}" +
    // Button icon/label structure
    W + " .zcc-btn-icon{display:inline-flex;align-items:center;flex-shrink:0}" +
    W + " .zcc-btn-icon svg{width:15px;height:15px;display:block}" +
    W + " .zcc-btn-label{display:inline}" +
    // Section grouping — visual hierarchy with dividers and breathing room
    W + " .zcc-section-divider{height:1px;background:rgba(0,0,0,0.06);margin:12px 0;border:none}" +
    W + " .zcc-info-group{display:flex;flex-direction:column;gap:6px}" +
    W + " .zcc-badges-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}" +
    // Meta info rows — aligned with storefront values
    W + " .zcc-meta{margin-top:0;font-size:13px;display:flex;align-items:center;gap:7px;color:#4b5563;line-height:1.4}" +
    W + " .zcc-meta svg{width:14px;height:14px;flex-shrink:0;opacity:0.7}" +
    W + " .zcc-meta strong{font-weight:600;color:" + cfg.textColor + "}" +
    W + " .zcc-meta span{flex:1}" +
    // Cutoff / days / return policy — separate classes matching storefront
    W + " .zcc-cutoff{margin-top:0;font-size:12px;color:#6d7175;display:flex;align-items:center;gap:7px}" +
    W + " .zcc-cutoff svg{width:13px;height:13px;flex-shrink:0;opacity:0.6}" +
    W + " .zcc-days{margin-top:0;font-size:12px;color:#6d7175;display:flex;align-items:center;gap:7px}" +
    W + " .zcc-days svg{width:13px;height:13px;flex-shrink:0;opacity:0.6}" +
    W + " .zcc-return-policy{margin-top:0;font-size:11px;color:#9ca3af;display:flex;align-items:center;gap:7px}" +
    W + " .zcc-return-policy svg{width:12px;height:12px;flex-shrink:0;opacity:0.45}" +
    W + " .zcc-return-policy span{flex:1}" +
    // COD badge — aligned with storefront values
    W + " .zcc-cod{margin-top:0;display:inline-flex;align-items:center;gap:5px;border-radius:20px;padding:4px 10px;font-size:12px;font-weight:600}" +
    W + " .zcc-cod svg{width:13px;height:13px;flex-shrink:0}" +
    W + " .zcc-cod--available{background:" + s + "12;border:1px solid " + s + "25;color:" + s + "}" +
    W + " .zcc-cod--unavailable{background:#d72c0d10;border:1px solid #d72c0d22;color:#d72c0d}" +
    // Delivery date
    W + " .zcc-delivery-date{margin-top:0;font-size:12px;color:#4b5563;display:flex;align-items:center;gap:7px;line-height:1.4}" +
    W + " .zcc-delivery-date svg{width:14px;height:14px;flex-shrink:0;opacity:0.7}" +
    W + " .zcc-delivery-date strong{font-weight:600;color:" + cfg.textColor + "}" +
    // Countdown timer — accent card for urgency
    W + " .zcc-countdown{margin-top:0;font-size:12.5px;display:flex;align-items:center;gap:7px;line-height:1.4;padding:6px 10px;border-radius:8px;background:#fef3c7;border:1px solid #fde68a}" +
    W + " .zcc-countdown svg{width:13px;height:13px;flex-shrink:0}" +
    W + " .zcc-countdown strong{font-weight:700}" +
    W + " .zcc-countdown--green{color:#16a34a;background:#f0fdf4;border-color:#bbf7d0}" +
    W + " .zcc-countdown--green strong{color:#16a34a}" +
    W + " .zcc-countdown--green svg{opacity:0.8}" +
    W + " .zcc-countdown--amber{color:#92400e;background:#fef3c7;border-color:#fde68a}" +
    W + " .zcc-countdown--amber strong{color:#92400e}" +
    W + " .zcc-countdown--amber svg{opacity:0.8}" +
    W + " .zcc-countdown--red{color:#dc2626;background:#fef2f2;border-color:#fecaca}" +
    W + " .zcc-countdown--red strong{color:#dc2626}" +
    W + " .zcc-countdown--red svg{opacity:0.8}" +
    W + " .zcc-countdown--passed{color:#6d7175;background:#f6f6f7;border-color:#e5e7eb}" +
    // Delivery fee
    W + " .zcc-delivery-fee{margin-top:0;display:inline-flex;align-items:center;gap:5px;border-radius:20px;padding:4px 10px;font-size:12px;font-weight:600}" +
    W + " .zcc-delivery-fee svg{width:13px;height:13px;flex-shrink:0}" +
    W + " .zcc-delivery-fee--free{background:" + s + "12;border:1px solid " + s + "25;color:" + s + "}" +
    W + " .zcc-delivery-fee--paid{background:#f59e0b10;border:1px solid #f59e0b22;color:#92400e}" +
    // Order timeline (ORDER → SHIPS → DELIVER) — more breathing room
    W + " .zcc-timeline{margin-top:0;display:flex;align-items:center;justify-content:space-between;gap:0;position:relative;padding:10px 4px}" +
    W + " .zcc-timeline::before{content:'';position:absolute;top:50%;left:16%;right:16%;height:2px;background:#e0e0e0;transform:translateY(-50%);z-index:0}" +
    W + " .zcc-timeline-step{display:flex;flex-direction:column;align-items:center;gap:4px;z-index:1;position:relative}" +
    W + " .zcc-timeline-dot{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid " + s + ";background:" + cfg.backgroundColor + "}" +
    W + " .zcc-timeline-dot--active{background:" + s + ";border-color:" + s + "}" +
    W + " .zcc-timeline-dot svg{width:12px;height:12px}" +
    W + " .zcc-timeline-label{font-size:10px;font-weight:600;color:#6d7175;text-transform:uppercase;letter-spacing:0.03em}" +
    W + " .zcc-timeline-sublabel{font-size:10px;color:#9ca3af;font-weight:500}" +
    W + " .zcc-timeline-connector{flex:1;height:2px;background:" + s + ";z-index:0}" +
    W + " .zcc-timeline-connector--pending{background:#e0e0e0}" +
    // Social proof
    W + " .zcc-social-proof{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#6d7175;margin-bottom:10px;background:#f6f6f7;padding:5px 10px;border-radius:20px;line-height:1.3}" +
    W + " .zcc-social-proof-icon{display:inline-flex;align-items:center;flex-shrink:0}" +
    W + " .zcc-social-proof-icon svg{width:14px;height:14px;display:block}" +
    // Waitlist
    W + " .zcc-wl-title{font-size:13px;font-weight:700;color:" + cfg.textColor + ";margin-bottom:8px;display:flex;align-items:center;gap:6px;padding-bottom:10px;border-bottom:1px solid #dde3ec}" +
    W + " .zcc-wl-toggle{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:" + cfg.primaryColor + ";text-decoration:none;cursor:pointer;border:none;background:none;padding:0;margin-top:8px}" +
    W + " .zcc-wl-toggle:hover{text-decoration:underline}" +
    W + " .zcc-wl-toggle svg{width:14px;height:14px;flex-shrink:0}" +
    W + " .zcc-wl-btn-icon{display:inline-flex;align-items:center;flex-shrink:0}" +
    W + " .zcc-wl-btn-icon svg{width:14px;height:14px;display:block}" +
    W + " .zcc-wl-btn-label{display:inline}"
  );
}

function buildWidgetCss(wid: string, cfg: WidgetConfig): string {
  const W = "#" + wid;
  const p = cfg.primaryColor;
  const s = cfg.successColor;
  const e = cfg.errorColor;
  const btnRadius = (cfg.borderRadius || "10") + "px";
  const base =
    "@keyframes zcc-slide-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}" +
    "@keyframes zcc-scale-in{from{transform:scale(0.92);opacity:0}to{transform:scale(1);opacity:1}}" +
    "@keyframes zcc-pulse-ring{0%{transform:scale(1);opacity:.5}50%{transform:scale(1.2);opacity:0}100%{transform:scale(1.2);opacity:0}}" +
    W + "{background:" + cfg.backgroundColor + ";color:" + cfg.textColor + ";padding:16px;border:none;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.08);max-width:480px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;box-sizing:border-box}" +
    W + " *{box-sizing:border-box}" +
    W + " .zcc-heading{font-size:15px;font-weight:700;letter-spacing:-0.01em;margin:0;color:" + cfg.textColor + ";display:flex;align-items:center;gap:8px;padding-bottom:12px;border-bottom:1px solid rgba(0,0,0,0.06);margin-bottom:12px}" +
    W + " .zcc-heading-icon{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg," + p + "18," + p + "08);flex-shrink:0}" +
    W + " .zcc-heading-icon svg{width:14px;height:14px}" +
    W + " .zcc-search-bar{display:flex;flex-direction:row;gap:10px;align-items:stretch}" +
    W + " .zcc-input{flex:1;min-width:0;padding:12px 16px;font-size:14px;border:1.5px solid #e0e0e0;border-radius:" + btnRadius + ";outline:none;background:#fafbfb;color:" + cfg.textColor + ";transition:border-color 0.2s,box-shadow 0.2s}" +
    W + " .zcc-input:focus{border-color:" + p + ";box-shadow:0 0 0 3px " + p + "15}" +
    W + " .zcc-input::placeholder{color:#9ca3af}" +
    W + " .zcc-btn{flex-shrink:0;white-space:nowrap;background:" + p + ";color:#fff;border:none;padding:12px 24px;min-width:110px;font-size:14px;font-weight:600;cursor:pointer;border-radius:" + btnRadius + ";box-shadow:0 2px 8px " + p + "25;transition:filter 0.2s,box-shadow 0.2s,transform 0.2s;display:flex;align-items:center;justify-content:center;gap:6px}" +
    W + " .zcc-btn:hover{filter:brightness(1.06);box-shadow:0 4px 14px " + p + "40;transform:translateY(-1px)}" +
    W + " .zcc-btn:active{filter:brightness(0.95);transform:translateY(0)}" +
    W + " .zcc-btn:disabled{opacity:.6;cursor:not-allowed;transform:none;box-shadow:none;filter:none}" +
    W + " .zcc-btn--error{background:" + e + "10;color:" + e + ";font-weight:700;box-shadow:none}" +
    W + " .zcc-result{margin-top:12px;padding:12px 14px;border-radius:12px;font-size:13.5px;line-height:1.5;animation:zcc-slide-in 0.35s cubic-bezier(0.34,1.56,0.64,1);display:flex;gap:12px;align-items:center}" +
    W + " .zcc-result.ok{background:" + s + "0c;border:1px solid " + s + "20;color:" + cfg.textColor + "}" +
    W + " .zcc-result.ok .zcc-result-icon svg{color:" + s + ";stroke:" + s + "}" +
    W + " .zcc-result.fail{background:" + e + "08;border:1px solid " + e + "18;color:" + cfg.textColor + "}" +
    W + " .zcc-result.fail .zcc-result-icon svg{color:" + e + ";stroke:" + e + "}" +
    W + " .zcc-wl{margin-top:10px;padding:14px;background:linear-gradient(135deg,#f8fafc,#f0f4f8);border-radius:12px;border:1px solid #dde3ec}" +
    W + " .zcc-wl-input{border-radius:8px;border:1.5px solid #dee2e6;padding:10px 14px;width:100%;display:block;margin-bottom:8px;outline:none;font-size:13px;transition:border-color 0.2s,box-shadow 0.2s;background:#fff;color:" + cfg.textColor + "}" +
    W + " .zcc-wl-btn{border-radius:" + btnRadius + ";background:" + p + ";color:#fff;padding:10px 20px;width:100%;font-weight:600;border:none;cursor:pointer;font-size:13px;transition:filter 0.2s,box-shadow 0.2s,transform 0.2s;letter-spacing:0.01em;box-shadow:0 2px 8px " + p + "25;display:flex;align-items:center;justify-content:center;gap:6px}" +
    W + " .zcc-wl-btn:hover{filter:brightness(1.06);box-shadow:0 4px 14px " + p + "40;transform:translateY(-1px)}" +
    W + " .zcc-wl-btn:active{filter:brightness(0.95);transform:translateY(0)}" +
    buildSharedMetaCss(W, cfg);
  return base + scopeAdminCss(cfg.customCss, wid);
}

// ── Floating preview sub-component ──────────────────────────────────────────
function FloatingPreview({
  cfg,
  css,
  wid,
  widgetHtml,
  pinIcon,
}: {
  cfg: WidgetConfig;
  css: string;
  wid: string;
  widgetHtml: React.ReactNode;
  pinIcon: React.ReactNode;
}) {
  const [panelOpen, setPanelOpen] = useState(true);

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {/* Floating layout — panel + trigger, no storefront mockup */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-end", minHeight: 500, justifyContent: "center" }}>
        {/* Panel */}
        {panelOpen && (
          <div
            style={{
              background: cfg.backgroundColor,
              borderRadius: 14,
              boxShadow: "0 8px 32px rgba(0,0,0,.12), 0 2px 8px rgba(0,0,0,.06)",
              width: "100%",
              overflow: "hidden",
              border: "1px solid rgba(0,0,0,0.06)",
            }}
          >
            {/* Panel header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                background: `linear-gradient(135deg, ${cfg.primaryColor}08, ${cfg.primaryColor}03)`,
                borderBottom: "1px solid rgba(0,0,0,0.06)",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: cfg.textColor,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: cfg.primaryColor + "18",
                }}>
                  {pinIcon}
                </span>
                {cfg.heading}
              </div>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                style={{
                  background: "rgba(0,0,0,0.05)",
                  border: "none",
                  cursor: "pointer",
                  color: cfg.textColor,
                  borderRadius: 6,
                  width: 24,
                  height: 24,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                  <path d="M18 6L6 18" /><path d="M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Panel body */}
            <div style={{ padding: "12px 14px 14px" }}>
              <style dangerouslySetInnerHTML={{ __html: `#${wid} .zcc-heading{display:none}` }} />
              {widgetHtml}
            </div>
          </div>
        )}

        {/* Trigger button */}
        <button
          type="button"
          onClick={() => setPanelOpen(!panelOpen)}
          style={{
            background: cfg.primaryColor,
            color: "#fff",
            border: "none",
            borderRadius: 50,
            padding: "12px 20px",
            fontSize: 13,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            cursor: "pointer",
            boxShadow: `0 4px 12px ${cfg.primaryColor}30`,
            whiteSpace: "nowrap" as const,
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
          </svg>
          {cfg.buttonText || "Check Delivery"}
        </button>
      </div>
    </>
  );
}

// ── Popup preview sub-component ─────────────────────────────────────────────
function PopupPreview({
  cfg,
  css,
  wid,
  widgetHtml,
  pinIcon,
}: {
  cfg: WidgetConfig;
  css: string;
  wid: string;
  widgetHtml: React.ReactNode;
  pinIcon: React.ReactNode;
}) {
  const [modalOpen, setModalOpen] = useState(true);

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div style={{ position: "relative" }}>
        {/* Trigger button (always visible) — pill with shadow */}
        <div style={{ marginBottom: modalOpen ? 16 : 0 }}>
          <button
            type="button"
            onClick={() => setModalOpen(!modalOpen)}
            style={{
              background: cfg.primaryColor,
              color: "#fff",
              border: "none",
              borderRadius: 50,
              padding: "13px 28px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              boxShadow: "0 2px 10px " + cfg.primaryColor + "25",
              transition: "filter 0.15s ease, transform 0.15s ease",
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
            </svg>
            {cfg.buttonText || cfg.heading}
          </button>
        </div>

        {/* Simulated modal overlay — glassmorphism */}
        {modalOpen && (
          <div
            style={{
              background: "rgba(0,0,0,.4)",
              backdropFilter: "blur(6px)",
              borderRadius: 10,
              padding: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 280,
            }}
          >
            {/* Modal card */}
            <div
              style={{
                background: cfg.backgroundColor,
                borderRadius: 18,
                boxShadow: "0 32px 64px rgba(0,0,0,.18), 0 8px 24px rgba(0,0,0,.08)",
                width: "100%",
                maxWidth: 420,
                overflow: "hidden",
                animation: "zcc-scale-in 0.3s cubic-bezier(0.34,1.56,0.64,1)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {/* Modal header — frosted */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 20px",
                  background: `linear-gradient(135deg, ${cfg.primaryColor}08, ${cfg.primaryColor}03)`,
                  borderBottom: "1px solid rgba(0,0,0,0.06)",
                }}
              >
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: cfg.textColor,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: cfg.primaryColor + "18",
                  }}>
                    {pinIcon}
                  </span>
                  {cfg.heading}
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  style={{
                    background: "rgba(0,0,0,0.05)",
                    border: "none",
                    cursor: "pointer",
                    color: cfg.textColor,
                    borderRadius: 8,
                    width: 28,
                    height: 28,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                    <path d="M18 6L6 18" /><path d="M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {/* Modal body — compact */}
              <div style={{ padding: "10px 18px 16px" }}>
                <style dangerouslySetInnerHTML={{ __html: `#${wid} .zcc-heading{display:none}` }} />
                {widgetHtml}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Live Preview component (defined outside WidgetPage to avoid remounting) ─
const WidgetPreview = memo(function WidgetPreview({
  cfg,
  previewState,
  widgetFullCustom,
  showEtaCodReturn,
}: {
  cfg: WidgetConfig;
  previewState: "idle" | "success" | "error" | "notfound";
  widgetFullCustom: boolean;
  showEtaCodReturn: boolean;
}) {
  const wid = "zcc-admin-preview";

  // Apply the same plan enforcement the API applies so the preview matches
  // exactly what will render on the storefront.
  const effectiveCfg: WidgetConfig = useMemo(() => {
    const c = { ...cfg };
    if (!widgetFullCustom) {
      c.primaryColor = DEFAULTS.primaryColor;
      c.successColor = DEFAULTS.successColor;
      c.errorColor = DEFAULTS.errorColor;
      c.backgroundColor = DEFAULTS.backgroundColor;
      c.textColor = DEFAULTS.textColor;
      c.position = DEFAULTS.position;
    }
    if (!showEtaCodReturn) {
      c.showEta = false;
      c.showZone = false;
      c.showCod = false;
      c.showReturnPolicy = false;
      c.showCutoffTime = false;
      c.showDeliveryDays = false;
      c.showDeliveryDate = false;
      c.showCountdown = false;
      c.showDeliveryFee = false;
    }
    return c;
  }, [cfg, widgetFullCustom, showEtaCodReturn]);

  const css = useMemo(() => buildWidgetCss(wid, effectiveCfg), [wid, effectiveCfg]);

  const resultMessage =
    previewState === "success" ? cfg.successMessage :
    previewState === "error" ? cfg.errorMessage :
    previewState === "notfound" ? cfg.notFoundMessage : null;

  // SVG icons as inline JSX — consistent outlined/stroke style
  // Use effectiveCfg for colors so the preview matches what storefront serves
  const iconStyle = { width: 16, height: 16, display: "block" as const };
  const metaIconStyle = { width: 14, height: 14, display: "block" as const, opacity: 0.7 };
  const pinIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke={effectiveCfg.primaryColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
    </svg>
  );
  const locationIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={metaIconStyle}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>
    </svg>
  );
  const checkCircleIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke={effectiveCfg.successColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>
    </svg>
  );
  const xCircleIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke={effectiveCfg.errorColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20, display: "block" as const }}>
      <circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>
    </svg>
  );
  const truckIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={metaIconStyle}>
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 13.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>
    </svg>
  );
  const clockIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={metaIconStyle}>
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
  const calendarIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={metaIconStyle}>
      <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>
    </svg>
  );
  const cardIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={metaIconStyle}>
      <rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>
    </svg>
  );
  const refreshIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={metaIconStyle}>
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>
    </svg>
  );
  const widgetHtml = (
    <div id={wid}>
      <div className="zcc-heading">
        <span className="zcc-heading-icon">{pinIcon}</span>
        <span>{cfg.heading}</span>
      </div>

      {/* Search bar — always visible, matching storefront structure */}
      <div className="zcc-search-bar">
        {previewState === "success" ? (
          <input className="zcc-input" type="text" value="10001" readOnly />
        ) : (previewState === "error" || previewState === "notfound") ? (
          <input className="zcc-input" type="text" value="380007" readOnly />
        ) : (
          <input className="zcc-input" type="text" placeholder={cfg.placeholder} readOnly />
        )}
        <button className="zcc-btn" type="button">
          <span className="zcc-btn-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15, display: "block" }}>
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
          </span>
          <span className="zcc-btn-label">{cfg.buttonText}</span>
        </button>
      </div>

      {/* Success result — uses same CSS classes as storefront widget */}
      {previewState === "success" && (
        <div className="zcc-result ok">
          <div className="zcc-result-icon">{checkCircleIcon}</div>
          <div className="zcc-result-content">
            {/* Group 1: Primary info — message + ETA + delivery date */}
            <div className="zcc-info-group">
              <div className="zcc-result-message">{cfg.successMessage}</div>
              {effectiveCfg.showEta && (
                <div className="zcc-meta">{truckIcon}<span>Estimated delivery: <strong>2-3 business days</strong></span></div>
              )}
              {effectiveCfg.showDeliveryDate && effectiveCfg.showEta && (
                <div className="zcc-meta zcc-delivery-date">{calendarIcon}<span>Expected by <strong>Friday, Mar 28</strong></span></div>
              )}
              {effectiveCfg.showZone && (
                <div className="zcc-meta">{locationIcon}<span>Zone: <strong>North</strong></span></div>
              )}
            </div>

            {/* Divider before timeline (only if timeline is visible) */}
            {effectiveCfg.showDeliveryDate && effectiveCfg.showEta && (
              <div className="zcc-section-divider" />
            )}

            {/* Group 2: Timeline */}
            {effectiveCfg.showDeliveryDate && effectiveCfg.showEta && (
              <div className="zcc-timeline">
                <div className="zcc-timeline-step">
                  <div className="zcc-timeline-dot zcc-timeline-dot--active">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <span className="zcc-timeline-label">Order</span>
                  <span className="zcc-timeline-sublabel">Today</span>
                </div>
                <div className="zcc-timeline-connector" />
                <div className="zcc-timeline-step">
                  <div className="zcc-timeline-dot zcc-timeline-dot--active">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                  </div>
                  <span className="zcc-timeline-label">Ships</span>
                  <span className="zcc-timeline-sublabel">Tomorrow</span>
                </div>
                <div className="zcc-timeline-connector zcc-timeline-connector--pending" />
                <div className="zcc-timeline-step">
                  <div className="zcc-timeline-dot">
                    <svg viewBox="0 0 24 24" fill="none" stroke={effectiveCfg.successColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  </div>
                  <span className="zcc-timeline-label">Deliver</span>
                  <span className="zcc-timeline-sublabel">Fri, Mar 28</span>
                </div>
              </div>
            )}

            {/* Divider before scheduling details (only if any scheduling info is visible) */}
            {(effectiveCfg.showDeliveryDays || effectiveCfg.showCutoffTime || (effectiveCfg.showCountdown && effectiveCfg.showCutoffTime)) && (
              <div className="zcc-section-divider" />
            )}

            {/* Group 3: Scheduling details — days + cutoff + countdown */}
            {(effectiveCfg.showDeliveryDays || effectiveCfg.showCutoffTime || (effectiveCfg.showCountdown && effectiveCfg.showCutoffTime)) && (
              <div className="zcc-info-group">
                {effectiveCfg.showDeliveryDays && (
                  <div className="zcc-meta zcc-days">{calendarIcon}<span>Mon &middot; Tue &middot; Wed &middot; Thu &middot; Fri</span></div>
                )}
                {effectiveCfg.showCutoffTime && (
                  <div className="zcc-meta zcc-cutoff">{clockIcon}<span>Order by <strong>2:00 PM</strong> for same-day</span></div>
                )}
                {effectiveCfg.showCountdown && effectiveCfg.showCutoffTime && (
                  <div className="zcc-countdown zcc-countdown--amber">{clockIcon}<span>Order within <strong>2h 14m</strong> for same-day dispatch</span></div>
                )}
              </div>
            )}

            {/* Divider before badges (only if any badge is visible) */}
            {(effectiveCfg.showCod || effectiveCfg.showDeliveryFee || effectiveCfg.showReturnPolicy) && (
              <div className="zcc-section-divider" />
            )}

            {/* Group 4: Badges + return policy */}
            {(effectiveCfg.showCod || effectiveCfg.showDeliveryFee) && (
              <div className="zcc-badges-row">
                {effectiveCfg.showCod && (
                  <div className="zcc-cod zcc-cod--available">{cardIcon} COD Available</div>
                )}
                {effectiveCfg.showDeliveryFee && (
                  <div className="zcc-delivery-fee zcc-delivery-fee--free">{truckIcon} Free Delivery</div>
                )}
              </div>
            )}
            {effectiveCfg.showReturnPolicy && (
              <div className="zcc-return-policy">{refreshIcon}<span>7-day easy returns</span></div>
            )}
          </div>
        </div>
      )}

      {/* Error / Not Found result — matches storefront rendering */}
      {(previewState === "error" || previewState === "notfound") && (
        <>
          <div className="zcc-result fail">
            <div className="zcc-result-icon">{xCircleIcon}</div>
            <div className="zcc-result-content">
              <div className="zcc-result-message">{resultMessage}</div>
            </div>
          </div>
          {cfg.showWaitlistOnFailure && (
            <div className="zcc-wl">
              {cfg.showSocialProof && (
                <div className="zcc-social-proof">
                  <span className="zcc-social-proof-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  </span>
                  Join 23 others waiting for delivery to your area
                </div>
              )}
              <button className="zcc-wl-toggle" type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14, display: "block" }}>
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
                </svg>
                {" "}Get Notified When We Deliver
              </button>
              <div style={{ marginTop: 12 }}>
                <input className="zcc-wl-input" type="text" placeholder="Your name" readOnly />
                <input className="zcc-wl-input" type="email" placeholder="Your email" readOnly />
                <button className="zcc-wl-btn" type="button">
                  <span className="zcc-wl-btn-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14, display: "block" }}>
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
                    </svg>
                  </span>
                  <span className="zcc-wl-btn-label">Notify Me</span>
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

  // Floating position: realistic storefront simulation with toggle
  if (effectiveCfg.position === "floating") {
    return (
      <FloatingPreview cfg={effectiveCfg} css={css} wid={wid} widgetHtml={widgetHtml} pinIcon={pinIcon} />
    );
  }

  // Popup position: realistic modal overlay simulation
  if (effectiveCfg.position === "popup") {
    return (
      <PopupPreview cfg={effectiveCfg} css={css} wid={wid} widgetHtml={widgetHtml} pinIcon={pinIcon} />
    );
  }

  // Inline (default)
  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {widgetHtml}
    </>
  );
});

// ── Reusable position tile selector ─────────────────────────────────────────
const PositionTile = memo(function PositionTile({
  value,
  label,
  selected,
  disabled,
  onSelect,
  children,
}: {
  value: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onSelect: (v: string) => void;
  children: React.ReactNode;
}) {
  const handleClick = useCallback(() => {
    if (!disabled) onSelect(value);
  }, [disabled, onSelect, value]);

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={handleClick}
      disabled={disabled}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) {
          e.preventDefault();
          onSelect(value);
        }
      }}
      style={{
        flex: 1,
        minWidth: 100,
        appearance: "none",
        WebkitAppearance: "none",
        border: "none",
        borderRadius: "var(--p-border-radius-200)",
        padding: "var(--p-space-300)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        textAlign: "center",
        outline: "none",
        transition: "box-shadow 0.15s ease, background 0.15s ease",
        background: selected
          ? "var(--p-color-bg-surface-selected)"
          : "var(--p-color-bg-surface)",
        boxShadow: selected
          ? "0 0 0 2px var(--p-color-border-emphasis)"
          : "0 0 0 1px var(--p-color-border)",
        fontFamily: "inherit",
        color: "inherit",
        fontSize: "inherit",
      }}
    >
      <BlockStack gap="100" inlineAlign="center">
        {children}
        <Text as="p" variant="bodySm" fontWeight={selected ? "semibold" : "regular"}>
          {label}
        </Text>
      </BlockStack>
    </button>
  );
});

// ── Page component ───────────────────────────────────────────────────────────
export default function WidgetPage() {
  const { config, subscription } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();

  const c = config as unknown as WidgetConfig;

  const limits = PLAN_LIMITS[subscription.planTier as PlanTier];

  // Form state initialized from DB
  const [position, setPosition] = useState(c.position);
  const [primaryColor, setPrimaryColor] = useState(c.primaryColor);
  const [successColor, setSuccessColor] = useState(c.successColor);
  const [errorColor, setErrorColor] = useState(c.errorColor);
  const [backgroundColor, setBackgroundColor] = useState(c.backgroundColor);
  const [textColor, setTextColor] = useState(c.textColor);
  const [heading, setHeading] = useState(c.heading);
  const [placeholder, setPlaceholder] = useState(c.placeholder);
  const [buttonText, setButtonText] = useState(c.buttonText);
  const [successMessage, setSuccessMessage] = useState(c.successMessage);
  const [errorMessage, setErrorMessage] = useState(c.errorMessage);
  const [notFoundMessage, setNotFoundMessage] = useState(c.notFoundMessage);
  const [showEta, setShowEta] = useState(c.showEta);
  const [showZone, setShowZone] = useState(c.showZone);
  const [showWaitlistOnFailure, setShowWaitlistOnFailure] = useState(
    c.showWaitlistOnFailure,
  );
  const [showCod, setShowCod] = useState(c.showCod ?? true);
  const [showReturnPolicy, setShowReturnPolicy] = useState(c.showReturnPolicy ?? true);
  const [showCutoffTime, setShowCutoffTime] = useState(c.showCutoffTime ?? true);
  const [showDeliveryDays, setShowDeliveryDays] = useState(c.showDeliveryDays ?? true);
  const [showDeliveryDate, setShowDeliveryDate] = useState(c.showDeliveryDate ?? true);
  const [showCountdown, setShowCountdown] = useState(c.showCountdown ?? true);
  const [showDeliveryFee, setShowDeliveryFee] = useState(c.showDeliveryFee ?? true);
  const [blockCartOnInvalid, setBlockCartOnInvalid] = useState(c.blockCartOnInvalid ?? false);
  const [blockCheckoutInCart, setBlockCheckoutInCart] = useState(c.blockCheckoutInCart ?? false);
  const [showSocialProof, setShowSocialProof] = useState(c.showSocialProof ?? true);
  const [lockButtonsUntilZipCheck, setLockButtonsUntilZipCheck] = useState((c as unknown as { lockButtonsUntilZipCheck?: boolean }).lockButtonsUntilZipCheck ?? true);
  const [borderRadius, setBorderRadius] = useState(c.borderRadius);
  const [customCss, setCustomCss] = useState(c.customCss || "");

  // Unsaved changes tracking
  const [isDirty, setIsDirty] = useState(false);

  // Preview state
  const [previewState, setPreviewState] = useState<
    "idle" | "success" | "error" | "notfound"
  >("idle");

  // Reset confirmation modal
  const [resetModalOpen, setResetModalOpen] = useState(false);

  const isSaving =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "save";

  const saveError =
    fetcher.state === "idle" &&
    fetcher.data &&
    "error" in fetcher.data
      ? (fetcher.data as { error: string }).error
      : null;

  // Clear dirty flag after successful save
  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data &&
      "success" in fetcher.data &&
      fetcher.data.success
    ) {
      setIsDirty(false);
    }
  }, [fetcher.state, fetcher.data]);

  // (Save bar managed via Page primaryAction)

  // Dirty-aware setters
  const mark = useCallback(() => setIsDirty(true), []);
  const handlePositionChange = useCallback((v: string) => { setPosition(v); mark(); }, [mark]);
  const handlePrimaryColorChange = useCallback((v: string) => { setPrimaryColor(v); mark(); }, [mark]);
  const handleSuccessColorChange = useCallback((v: string) => { setSuccessColor(v); mark(); }, [mark]);
  const handleErrorColorChange = useCallback((v: string) => { setErrorColor(v); mark(); }, [mark]);
  const handleBackgroundColorChange = useCallback((v: string) => { setBackgroundColor(v); mark(); }, [mark]);
  const handleTextColorChange = useCallback((v: string) => { setTextColor(v); mark(); }, [mark]);
  const handleHeadingChange = useCallback((v: string) => { setHeading(v); mark(); }, [mark]);
  const handlePlaceholderChange = useCallback((v: string) => { setPlaceholder(v); mark(); }, [mark]);
  const handleButtonTextChange = useCallback((v: string) => { setButtonText(v); mark(); }, [mark]);
  const handleSuccessMessageChange = useCallback((v: string) => { setSuccessMessage(v); mark(); }, [mark]);
  const handleErrorMessageChange = useCallback((v: string) => { setErrorMessage(v); mark(); }, [mark]);
  const handleNotFoundMessageChange = useCallback((v: string) => { setNotFoundMessage(v); mark(); }, [mark]);
  const handleShowEtaChange = useCallback((v: boolean) => { setShowEta(v); mark(); }, [mark]);
  const handleShowZoneChange = useCallback((v: boolean) => { setShowZone(v); mark(); }, [mark]);
  const handleShowWaitlistChange = useCallback((v: boolean) => { setShowWaitlistOnFailure(v); mark(); }, [mark]);
  const handleShowCodChange = useCallback((v: boolean) => { setShowCod(v); mark(); }, [mark]);
  const handleShowReturnPolicyChange = useCallback((v: boolean) => { setShowReturnPolicy(v); mark(); }, [mark]);
  const handleShowCutoffTimeChange = useCallback((v: boolean) => { setShowCutoffTime(v); mark(); }, [mark]);
  const handleShowDeliveryDaysChange = useCallback((v: boolean) => { setShowDeliveryDays(v); mark(); }, [mark]);
  const handleShowDeliveryDateChange = useCallback((v: boolean) => { setShowDeliveryDate(v); mark(); }, [mark]);
  const handleShowCountdownChange = useCallback((v: boolean) => { setShowCountdown(v); mark(); }, [mark]);
  const handleShowDeliveryFeeChange = useCallback((v: boolean) => { setShowDeliveryFee(v); mark(); }, [mark]);
  const handleBlockCartOnInvalidChange = useCallback((v: boolean) => { setBlockCartOnInvalid(v); mark(); }, [mark]);
  const handleBlockCheckoutInCartChange = useCallback((v: boolean) => { setBlockCheckoutInCart(v); mark(); }, [mark]);
  const handleShowSocialProofChange = useCallback((v: boolean) => { setShowSocialProof(v); mark(); }, [mark]);
  const handleLockButtonsUntilZipCheckChange = useCallback((v: boolean) => { setLockButtonsUntilZipCheck(v); mark(); }, [mark]);
  const handleBorderRadiusChange = useCallback((v: string) => { setBorderRadius(v); mark(); }, [mark]);
  const handleCustomCssChange = useCallback((v: string) => { setCustomCss(v); mark(); }, [mark]);

  const handleSave = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "save");
    fd.set("position", position);
    fd.set("primaryColor", primaryColor);
    fd.set("successColor", successColor);
    fd.set("errorColor", errorColor);
    fd.set("backgroundColor", backgroundColor);
    fd.set("textColor", textColor);
    fd.set("heading", heading);
    fd.set("placeholder", placeholder);
    fd.set("buttonText", buttonText);
    fd.set("successMessage", successMessage);
    fd.set("errorMessage", errorMessage);
    fd.set("notFoundMessage", notFoundMessage);
    fd.set("showEta", String(showEta));
    fd.set("showZone", String(showZone));
    fd.set("showWaitlistOnFailure", String(showWaitlistOnFailure));
    fd.set("showCod", String(showCod));
    fd.set("showReturnPolicy", String(showReturnPolicy));
    fd.set("showCutoffTime", String(showCutoffTime));
    fd.set("showDeliveryDays", String(showDeliveryDays));
    fd.set("showDeliveryDate", String(showDeliveryDate));
    fd.set("showCountdown", String(showCountdown));
    fd.set("showDeliveryFee", String(showDeliveryFee));
    fd.set("blockCartOnInvalid", String(blockCartOnInvalid));
    fd.set("blockCheckoutInCart", String(blockCheckoutInCart));
    fd.set("showSocialProof", String(showSocialProof));
    fd.set("lockButtonsUntilZipCheck", String(lockButtonsUntilZipCheck));
    fd.set("borderRadius", borderRadius);
    fd.set("customCss", customCss);
    fetcher.submit(fd, { method: "POST" });
    shopify.toast.show("Widget settings saved");
  }, [
    position, primaryColor, successColor, errorColor, backgroundColor,
    textColor, heading, placeholder, buttonText, successMessage, errorMessage,
    notFoundMessage, showEta, showZone, showWaitlistOnFailure, showCod,
    showReturnPolicy, showCutoffTime, showDeliveryDays, showDeliveryDate,
    showCountdown, showDeliveryFee, blockCartOnInvalid,
    blockCheckoutInCart, showSocialProof, lockButtonsUntilZipCheck, borderRadius, customCss,
    fetcher, shopify,
  ]);

  const handleResetConfirm = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "reset");
    fetcher.submit(fd, { method: "POST" });
    setPosition(DEFAULTS.position);
    setPrimaryColor(DEFAULTS.primaryColor);
    setSuccessColor(DEFAULTS.successColor);
    setErrorColor(DEFAULTS.errorColor);
    setBackgroundColor(DEFAULTS.backgroundColor);
    setTextColor(DEFAULTS.textColor);
    setHeading(DEFAULTS.heading);
    setPlaceholder(DEFAULTS.placeholder);
    setButtonText(DEFAULTS.buttonText);
    setSuccessMessage(DEFAULTS.successMessage);
    setErrorMessage(DEFAULTS.errorMessage);
    setNotFoundMessage(DEFAULTS.notFoundMessage);
    setShowEta(DEFAULTS.showEta);
    setShowZone(DEFAULTS.showZone);
    setShowWaitlistOnFailure(DEFAULTS.showWaitlistOnFailure);
    setShowCod(DEFAULTS.showCod);
    setShowReturnPolicy(DEFAULTS.showReturnPolicy);
    setShowCutoffTime(DEFAULTS.showCutoffTime);
    setShowDeliveryDays(DEFAULTS.showDeliveryDays);
    setShowDeliveryDate(DEFAULTS.showDeliveryDate);
    setShowCountdown(DEFAULTS.showCountdown);
    setShowDeliveryFee(DEFAULTS.showDeliveryFee);
    setBlockCartOnInvalid(DEFAULTS.blockCartOnInvalid);
    setBlockCheckoutInCart(DEFAULTS.blockCheckoutInCart);
    setShowSocialProof(DEFAULTS.showSocialProof);
    setLockButtonsUntilZipCheck(DEFAULTS.lockButtonsUntilZipCheck);
    setBorderRadius(DEFAULTS.borderRadius);
    setCustomCss(DEFAULTS.customCss);
    setPreviewState("idle");
    setIsDirty(false);
    setResetModalOpen(false);
    shopify.toast.show("Widget settings reset to defaults");
  }, [fetcher, shopify]);

  // Current config snapshot for the preview (memoized to avoid re-renders)
  const previewCfg: WidgetConfig = useMemo(() => ({
    position, primaryColor, successColor, errorColor, backgroundColor,
    textColor, heading, placeholder, buttonText, successMessage, errorMessage,
    notFoundMessage, showEta, showZone, showWaitlistOnFailure, showCod,
    showReturnPolicy, showCutoffTime, showDeliveryDays, showDeliveryDate,
    showCountdown, showDeliveryFee, blockCartOnInvalid,
    blockCheckoutInCart, showSocialProof, lockButtonsUntilZipCheck, borderRadius, customCss,
  }), [
    position, primaryColor, successColor, errorColor, backgroundColor,
    textColor, heading, placeholder, buttonText, successMessage, errorMessage,
    notFoundMessage, showEta, showZone, showWaitlistOnFailure, showCod,
    showReturnPolicy, showCutoffTime, showDeliveryDays, showDeliveryDate,
    showCountdown, showDeliveryFee, blockCartOnInvalid,
    blockCheckoutInCart, showSocialProof, lockButtonsUntilZipCheck, borderRadius, customCss,
  ]);

  const handleDiscard = useCallback(() => {
    setPosition(c.position);
    setPrimaryColor(c.primaryColor);
    setSuccessColor(c.successColor);
    setErrorColor(c.errorColor);
    setBackgroundColor(c.backgroundColor);
    setTextColor(c.textColor);
    setHeading(c.heading);
    setPlaceholder(c.placeholder);
    setButtonText(c.buttonText);
    setSuccessMessage(c.successMessage);
    setErrorMessage(c.errorMessage);
    setNotFoundMessage(c.notFoundMessage);
    setShowEta(c.showEta);
    setShowZone(c.showZone);
    setShowWaitlistOnFailure(c.showWaitlistOnFailure);
    setShowCod(c.showCod ?? true);
    setShowReturnPolicy(c.showReturnPolicy ?? true);
    setShowCutoffTime(c.showCutoffTime ?? true);
    setShowDeliveryDays(c.showDeliveryDays ?? true);
    setShowDeliveryDate(c.showDeliveryDate ?? true);
    setShowCountdown(c.showCountdown ?? true);
    setShowDeliveryFee(c.showDeliveryFee ?? true);
    setBlockCartOnInvalid(c.blockCartOnInvalid ?? false);
    setBlockCheckoutInCart(c.blockCheckoutInCart ?? false);
    setShowSocialProof(c.showSocialProof ?? true);
    setLockButtonsUntilZipCheck((c as unknown as { lockButtonsUntilZipCheck?: boolean }).lockButtonsUntilZipCheck ?? true);
    setBorderRadius(c.borderRadius);
    setCustomCss(c.customCss || "");
    setIsDirty(false);
    setPreviewState("idle");
  }, [c]);

  return (
    <Page
      title="Widget Customization"
      subtitle="Customize how Pinzo looks on your storefront"
      backAction={{ onAction: () => navigate("/app") }}
      primaryAction={isDirty ? {
        content: "Save Changes",
        onAction: handleSave,
        loading: isSaving,
      } : undefined}
      secondaryActions={[
        ...(isDirty ? [{
          content: "Discard",
          onAction: handleDiscard,
        }] : []),
        {
          content: "Reset to Defaults",
          onAction: () => setResetModalOpen(true),
        },
      ]}
    >
      <Box paddingBlockEnd="1600">
        <Layout>

          {saveError && (
            <Layout.Section>
              <Banner tone="critical" title="Failed to save widget settings">
                {saveError}
              </Banner>
            </Layout.Section>
          )}

          {/* Settings + Preview */}
          <Layout.Section>
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400" alignItems="start">
              {/* ── Settings Column ── */}
              <BlockStack gap="400">

                {/* Layout — Position Only */}
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">Layout</Text>
                      {!limits.widgetFullCustom && (
                        <Badge tone="info">Starter+</Badge>
                      )}
                    </InlineStack>
                    <InlineStack gap="200" wrap>
                      <PositionTile value="inline" label="Inline" selected={position === "inline"} disabled={!limits.widgetFullCustom} onSelect={handlePositionChange}>
                        <svg viewBox="0 0 32 32" fill="none" style={{ width: 28, height: 28, margin: "0 auto" }}>
                          <rect x="4" y="4" width="24" height="24" rx="4" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                          <rect x="8" y="12" width="16" height="8" rx="2" fill={position === "inline" ? "var(--p-color-icon-emphasis)" : "var(--p-color-icon-secondary)"} opacity="0.6"/>
                        </svg>
                      </PositionTile>
                      <PositionTile value="floating" label="Floating" selected={position === "floating"} disabled={!limits.widgetFullCustom} onSelect={handlePositionChange}>
                        <svg viewBox="0 0 32 32" fill="none" style={{ width: 28, height: 28, margin: "0 auto" }}>
                          <rect x="4" y="4" width="24" height="24" rx="4" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                          <circle cx="24" cy="24" r="5" fill={position === "floating" ? "var(--p-color-icon-emphasis)" : "var(--p-color-icon-secondary)"} opacity="0.7"/>
                        </svg>
                      </PositionTile>
                      <PositionTile value="popup" label="Popup" selected={position === "popup"} disabled={!limits.widgetFullCustom} onSelect={handlePositionChange}>
                        <svg viewBox="0 0 32 32" fill="none" style={{ width: 28, height: 28, margin: "0 auto" }}>
                          <rect x="4" y="4" width="24" height="24" rx="4" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                          <rect x="9" y="9" width="14" height="14" rx="3" stroke={position === "popup" ? "var(--p-color-icon-emphasis)" : "var(--p-color-icon-secondary)"} strokeWidth="1.5" fill={position === "popup" ? "var(--p-color-icon-emphasis)" : "var(--p-color-icon-secondary)"} opacity="0.5"/>
                        </svg>
                      </PositionTile>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {position === "floating"
                        ? "Fixed button in the bottom-right corner of every page."
                        : position === "popup"
                        ? "A trigger button that opens a centered popup overlay."
                        : "Renders directly where you place the block in the Theme Editor."}
                    </Text>
                    {!limits.widgetFullCustom && (
                      <Banner tone="info">
                        <Text as="p" variant="bodySm">
                          Upgrade to Starter to customize widget position.{" "}
                          <Button variant="plain" onClick={() => navigate("/app/pricing")}>View plans</Button>
                        </Text>
                      </Banner>
                    )}
                  </BlockStack>
                </Card>

                {/* Colors */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        Colors
                      </Text>
                      {!limits.widgetFullCustom && (
                        <Badge tone="info">Starter+</Badge>
                      )}
                    </InlineStack>
                    <InlineStack gap="300" wrap>
                      <Box minWidth="140px" width="100%">
                        <BlockStack gap="100">
                          <Text as="p" variant="bodySm">
                            Button Color
                          </Text>
                          <InlineStack gap="200" blockAlign="center">
                            <input
                              type="color"
                              value={primaryColor}
                              onChange={(e) => handlePrimaryColorChange(e.target.value)}
                              disabled={!limits.widgetFullCustom}
                              style={{
                                width: "36px",
                                height: "36px",
                                border: "2px solid var(--p-color-border-secondary)",
                                borderRadius: "var(--p-border-radius-200)",
                                cursor: limits.widgetFullCustom ? "pointer" : "not-allowed",
                                padding: "2px",
                                opacity: limits.widgetFullCustom ? 1 : 0.5,
                              }}
                            />
                            <TextField
                              label="Button"
                              labelHidden
                              value={primaryColor}
                              onChange={handlePrimaryColorChange}
                              autoComplete="off"
                              disabled={!limits.widgetFullCustom}
                            />
                          </InlineStack>
                        </BlockStack>
                      </Box>
                      <Box minWidth="140px" width="100%">
                        <BlockStack gap="100">
                          <Text as="p" variant="bodySm">
                            Success Color
                          </Text>
                          <InlineStack gap="200" blockAlign="center">
                            <input
                              type="color"
                              value={successColor}
                              onChange={(e) => handleSuccessColorChange(e.target.value)}
                              disabled={!limits.widgetFullCustom}
                              style={{
                                width: "36px",
                                height: "36px",
                                border: "2px solid var(--p-color-border-secondary)",
                                borderRadius: "var(--p-border-radius-200)",
                                cursor: limits.widgetFullCustom ? "pointer" : "not-allowed",
                                padding: "2px",
                                opacity: limits.widgetFullCustom ? 1 : 0.5,
                              }}
                            />
                            <TextField
                              label="Success"
                              labelHidden
                              value={successColor}
                              onChange={handleSuccessColorChange}
                              autoComplete="off"
                              disabled={!limits.widgetFullCustom}
                            />
                          </InlineStack>
                        </BlockStack>
                      </Box>
                    </InlineStack>
                    <InlineStack gap="300" wrap>
                      <Box minWidth="140px" width="100%">
                        <BlockStack gap="100">
                          <Text as="p" variant="bodySm">
                            Error Color
                          </Text>
                          <InlineStack gap="200" blockAlign="center">
                            <input
                              type="color"
                              value={errorColor}
                              onChange={(e) => handleErrorColorChange(e.target.value)}
                              disabled={!limits.widgetFullCustom}
                              style={{
                                width: "36px",
                                height: "36px",
                                border: "2px solid var(--p-color-border-secondary)",
                                borderRadius: "var(--p-border-radius-200)",
                                cursor: limits.widgetFullCustom ? "pointer" : "not-allowed",
                                padding: "2px",
                                opacity: limits.widgetFullCustom ? 1 : 0.5,
                              }}
                            />
                            <TextField
                              label="Error"
                              labelHidden
                              value={errorColor}
                              onChange={handleErrorColorChange}
                              autoComplete="off"
                              disabled={!limits.widgetFullCustom}
                            />
                          </InlineStack>
                        </BlockStack>
                      </Box>
                      <Box minWidth="140px" width="100%">
                        <BlockStack gap="100">
                          <Text as="p" variant="bodySm">
                            Background
                          </Text>
                          <InlineStack gap="200" blockAlign="center">
                            <input
                              type="color"
                              value={backgroundColor}
                              onChange={(e) => handleBackgroundColorChange(e.target.value)}
                              disabled={!limits.widgetFullCustom}
                              style={{
                                width: "36px",
                                height: "36px",
                                border: "2px solid var(--p-color-border-secondary)",
                                borderRadius: "var(--p-border-radius-200)",
                                cursor: limits.widgetFullCustom ? "pointer" : "not-allowed",
                                padding: "2px",
                                opacity: limits.widgetFullCustom ? 1 : 0.5,
                              }}
                            />
                            <TextField
                              label="BG"
                              labelHidden
                              value={backgroundColor}
                              onChange={handleBackgroundColorChange}
                              autoComplete="off"
                              disabled={!limits.widgetFullCustom}
                            />
                          </InlineStack>
                        </BlockStack>
                      </Box>
                    </InlineStack>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm">
                        Text Color
                      </Text>
                      <InlineStack gap="200" blockAlign="center">
                        <input
                          type="color"
                          value={textColor}
                          onChange={(e) => handleTextColorChange(e.target.value)}
                          disabled={!limits.widgetFullCustom}
                          style={{
                            width: "36px",
                            height: "36px",
                            border: "2px solid var(--p-color-border-secondary)",
                            borderRadius: "var(--p-border-radius-200)",
                            cursor: limits.widgetFullCustom ? "pointer" : "not-allowed",
                            padding: "2px",
                            opacity: limits.widgetFullCustom ? 1 : 0.5,
                          }}
                        />
                        <TextField
                          label="Text"
                          labelHidden
                          value={textColor}
                          onChange={handleTextColorChange}
                          autoComplete="off"
                          disabled={!limits.widgetFullCustom}
                        />
                      </InlineStack>
                    </BlockStack>
                    <Divider />
                    <TextField
                      label="Border Radius (px)"
                      type="number"
                      value={borderRadius}
                      onChange={handleBorderRadiusChange}
                      autoComplete="off"
                      disabled={!limits.widgetFullCustom}
                      helpText="Roundness of corners. 0 = square, 16 = very rounded."
                    />
                    {!limits.widgetFullCustom && (
                      <Banner tone="info">
                        <Text as="p" variant="bodySm">
                          Upgrade to Starter to customize widget colors.{" "}
                          <Button
                            variant="plain"
                            onClick={() => navigate("/app/pricing")}
                          >
                            View plans
                          </Button>
                        </Text>
                      </Banner>
                    )}
                  </BlockStack>
                </Card>

                {/* Text Content */}
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      Text Content
                    </Text>
                    <TextField
                      label="Heading"
                      value={heading}
                      onChange={handleHeadingChange}
                      autoComplete="off"
                    />
                    <InlineGrid columns={2} gap="300">
                      <TextField
                        label="Placeholder"
                        value={placeholder}
                        onChange={handlePlaceholderChange}
                        autoComplete="off"
                      />
                      <TextField
                        label="Button Text"
                        value={buttonText}
                        onChange={handleButtonTextChange}
                        autoComplete="off"
                      />
                    </InlineGrid>
                    <TextField
                      label="Success Message"
                      value={successMessage}
                      onChange={handleSuccessMessageChange}
                      autoComplete="off"
                      multiline={2}
                    />
                    <TextField
                      label="Error Message (blocked)"
                      value={errorMessage}
                      onChange={handleErrorMessageChange}
                      autoComplete="off"
                      multiline={2}
                    />
                    <TextField
                      label="Not Found Message"
                      value={notFoundMessage}
                      onChange={handleNotFoundMessageChange}
                      autoComplete="off"
                      multiline={2}
                    />
                  </BlockStack>
                </Card>

                {/* Display Options */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        Display Options
                      </Text>
                      {!limits.showEtaCodReturn && (
                        <Badge tone="info">Starter+</Badge>
                      )}
                    </InlineStack>
                    <Checkbox
                      label="Show estimated delivery time (ETA)"
                      checked={showEta}
                      onChange={handleShowEtaChange}
                      disabled={!limits.showEtaCodReturn}
                      helpText="Display the ETA below the success message when available."
                    />
                    <Checkbox
                      label="Show delivery zone name"
                      checked={showZone}
                      onChange={handleShowZoneChange}
                      helpText="Display the zone name in the success message."
                    />
                    <Checkbox
                      label="Show waitlist form on blocked/not-found zip codes"
                      checked={showWaitlistOnFailure}
                      onChange={handleShowWaitlistChange}
                      helpText="Let customers enter their email to join a waitlist when their zip code isn't available."
                    />
                    <Checkbox
                      label="Show cutoff time"
                      checked={showCutoffTime}
                      onChange={handleShowCutoffTimeChange}
                      helpText="Display order cutoff time for same-day delivery (from the matched delivery rule)."
                    />
                    <Checkbox
                      label="Show delivery days"
                      checked={showDeliveryDays}
                      onChange={handleShowDeliveryDaysChange}
                      helpText="Display which days of the week delivery is available (from the matched delivery rule)."
                    />
                    <Checkbox
                      label="Show estimated delivery date"
                      checked={showDeliveryDate}
                      onChange={handleShowDeliveryDateChange}
                      disabled={!limits.showEtaCodReturn}
                      helpText='Calculates and shows "Expected by Friday, Mar 27" from ETA.'
                    />
                    <Checkbox
                      label="Show countdown timer"
                      checked={showCountdown}
                      onChange={handleShowCountdownChange}
                      disabled={!limits.showEtaCodReturn}
                      helpText='Live countdown to order cutoff with urgency colors.'
                    />
                    <Checkbox
                      label="Show delivery fee"
                      checked={showDeliveryFee}
                      onChange={handleShowDeliveryFeeChange}
                      disabled={!limits.showEtaCodReturn}
                      helpText='Shows "Free Delivery" or delivery cost from your rules.'
                    />
                    <Checkbox
                      label="Show COD (Cash on Delivery) availability"
                      checked={showCod}
                      onChange={handleShowCodChange}
                      disabled={!limits.showEtaCodReturn}
                      helpText="Display whether cash on delivery is available for the entered zip code."
                    />
                    <Checkbox
                      label="Show return / exchange policy"
                      checked={showReturnPolicy}
                      onChange={handleShowReturnPolicyChange}
                      disabled={!limits.showEtaCodReturn}
                      helpText="Display the return and exchange policy associated with the entered zip code."
                    />
                    {!limits.showEtaCodReturn && (
                      <Banner tone="info">
                        <Text as="p" variant="bodySm">
                          Upgrade to Starter to enable ETA, COD, and return policy toggles.{" "}
                          <Button
                            variant="plain"
                            onClick={() => navigate("/app/pricing")}
                          >
                            View plans
                          </Button>
                        </Text>
                      </Banner>
                    )}
                    <Divider />
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="headingMd" as="h3">Purchase Protection</Text>
                      {!limits.cartBlocking && (
                        <Badge tone="info">Pro+</Badge>
                      )}
                    </InlineStack>
                    <Checkbox
                      label="Block Add to Cart for unserviceable ZIP codes"
                      helpText="Disables the Add to Cart and Buy Now buttons when a customer enters an invalid ZIP code. Buttons re-enable on a valid check."
                      checked={blockCartOnInvalid}
                      onChange={handleBlockCartOnInvalidChange}
                      disabled={!limits.cartBlocking}
                    />
                    <Checkbox
                      label="Block checkout in cart for unserviceable ZIP codes"
                      helpText="Shows a warning and hides the checkout button on the cart page if the last checked ZIP was unserviceable. Requires the Cart Validator block on your cart page."
                      checked={blockCheckoutInCart}
                      onChange={handleBlockCheckoutInCartChange}
                      disabled={!limits.cartBlocking}
                    />
                    <Checkbox
                      label="Disable Add to Cart until ZIP code is verified (Floating/Popup only)"
                      helpText="When the widget is in Floating or Popup mode, the Add to Cart and Buy Now buttons are disabled until the customer successfully validates their ZIP code. Has no effect in Inline mode."
                      checked={lockButtonsUntilZipCheck}
                      onChange={handleLockButtonsUntilZipCheckChange}
                    />
                    {!limits.cartBlocking && (
                      <Banner tone="info">
                        <Text as="p" variant="bodySm">
                          Upgrade to Pro to block Add to Cart for unserviceable ZIP codes and block checkout in the cart.{" "}
                          <Button
                            variant="plain"
                            onClick={() => navigate("/app/pricing")}
                          >
                            View plans
                          </Button>
                        </Text>
                      </Banner>
                    )}
                    <Divider />
                    <Text variant="headingMd" as="h3">Waitlist Engagement</Text>
                    <Checkbox
                      label="Show social proof on waitlist form"
                      helpText="Displays how many other customers are waiting for delivery to the same ZIP code. Example: 'Join 23 others waiting for delivery to your area.'"
                      checked={showSocialProof}
                      onChange={handleShowSocialProofChange}
                    />
                  </BlockStack>
                </Card>

                {/* Custom CSS */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        Custom CSS
                      </Text>
                      {!limits.customCss && (
                        <Badge tone="info">Ultimate</Badge>
                      )}
                    </InlineStack>
                    <TextField
                      label="Custom CSS"
                      labelHidden
                      value={customCss}
                      onChange={handleCustomCssChange}
                      multiline={4}
                      placeholder=".zcc-heading { font-size: 18px; } .zcc-btn { border-radius: 4px; }"
                      autoComplete="off"
                      disabled={!limits.customCss}
                      maxLength={MAX_CUSTOM_CSS_LENGTH}
                      helpText="Target widget elements with these classes: .zcc-heading, .zcc-heading-icon, .zcc-search-bar, .zcc-input, .zcc-btn, .zcc-btn-icon, .zcc-btn-label, .zcc-result, .zcc-result-icon, .zcc-result-message, .zcc-meta, .zcc-cutoff, .zcc-days, .zcc-cod, .zcc-return-policy, .zcc-delivery-date, .zcc-countdown, .zcc-delivery-fee, .zcc-wl (waitlist), .zcc-wl-input, .zcc-wl-btn, .zcc-social-proof. All selectors are automatically scoped to the widget — your CSS won't affect the rest of your store."
                    />
                    {!limits.customCss && (
                      <Banner tone="info">
                        <Text as="p" variant="bodySm">
                          Upgrade to Ultimate to add custom CSS overrides.{" "}
                          <Button
                            variant="plain"
                            onClick={() => navigate("/app/pricing")}
                          >
                            View plans
                          </Button>
                        </Text>
                      </Banner>
                    )}
                  </BlockStack>
                </Card>
              </BlockStack>

              {/* ── Live Preview Column ── */}
              <div style={{ position: "sticky", top: "16px", alignSelf: "start" }}>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        Live Preview
                      </Text>
                      <Badge tone={position === "floating" ? "attention" : position === "popup" ? "info" : "success"}>
                        {position === "floating" ? "Floating" : position === "popup" ? "Popup" : "Inline"}
                      </Badge>
                    </InlineStack>
                    <Divider />

                    {/* Preview state toggle — custom pill tabs */}
                    <div style={{
                      display: "flex",
                      background: "#f1f5f9",
                      borderRadius: 10,
                      padding: 3,
                      gap: 2,
                    }}>
                      {([
                        { key: "idle", label: "Default", color: "#94a3b8" },
                        { key: "success", label: "Success", color: "#22c55e" },
                        { key: "error", label: "Blocked", color: "#ef4444" },
                        { key: "notfound", label: "Not Found", color: "#f59e0b" },
                      ] as const).map(s => (
                        <button
                          key={s.key}
                          type="button"
                          onClick={() => setPreviewState(s.key)}
                          style={{
                            flex: 1,
                            padding: "8px 0",
                            borderRadius: 8,
                            border: "none",
                            fontSize: 12,
                            fontWeight: previewState === s.key ? 600 : 500,
                            background: previewState === s.key ? "#fff" : "transparent",
                            boxShadow: previewState === s.key ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                            color: previewState === s.key ? s.color : "#64748b",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                          }}
                        >
                          <span style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background: previewState === s.key ? s.color : "#cbd5e1",
                            transition: "background 0.15s ease",
                            flexShrink: 0,
                          }} />
                          {s.label}
                        </button>
                      ))}
                    </div>

                    {/* Plan enforcement notice — shown when Free plan strips colors */}
                    {!limits.widgetFullCustom && (
                      <Banner tone="warning">
                        <Text as="p" variant="bodySm">
                          This preview shows how the widget will look on your storefront. Custom colors require a Starter plan or above — the widget uses default colors until you upgrade.{" "}
                          <Button variant="plain" onClick={() => navigate("/app/pricing")}>Upgrade now</Button>
                        </Text>
                      </Banner>
                    )}

                    {/* Preview widget — device frame + dot-grid */}
                    <div style={{
                      border: "1px solid #d1d8e0",
                      borderRadius: 12,
                      overflow: "hidden",
                      background: "#f1f5f9",
                    }}>
                      {/* Browser chrome */}
                      <div style={{
                        height: 32,
                        background: "#e8edf2",
                        borderBottom: "1px solid #d1d8e0",
                        display: "flex",
                        alignItems: "center",
                        padding: "0 12px",
                        gap: 6,
                      }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff5f57" }} />
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#febc2e" }} />
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#28c840" }} />
                      </div>
                      {/* Preview area */}
                      <div style={{
                        padding: 24,
                        background: "radial-gradient(circle, #d1d8e0 1px, transparent 1px)",
                        backgroundSize: "20px 20px",
                        backgroundColor: "#eef2f6",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: 340,
                      }}>
                        <WidgetPreview cfg={previewCfg} previewState={previewState} widgetFullCustom={limits.widgetFullCustom} showEtaCodReturn={limits.showEtaCodReturn} />
                      </div>
                    </div>
                  </BlockStack>
                </Card>
              </div>
            </InlineGrid>
          </Layout.Section>
        </Layout>
      </Box>
      {/* Reset Confirmation Modal */}
      <Modal
        open={resetModalOpen}
        onClose={() => setResetModalOpen(false)}
        title="Reset to default settings?"
        primaryAction={{
          content: "Reset to Defaults",
          onAction: handleResetConfirm,
          destructive: true,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setResetModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            This will erase all your current widget customizations (colors,
            messages, toggles, custom CSS) and restore the original default
            settings. This action cannot be undone.
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

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
        blockCartOnInvalid: formData.get("blockCartOnInvalid") === "true",
        blockCheckoutInCart: formData.get("blockCheckoutInCart") === "true",
        showSocialProof: formData.get("showSocialProof") === "true",
        borderRadius: String(formData.get("borderRadius") || "8"),
        customCss: String(formData.get("customCss") || "") || null,
      };

      // Server-side plan gating: strip premium fields the shop's plan doesn't allow
      const subscription = await getShopSubscription(shop);
      const limits = PLAN_LIMITS[subscription.planTier];
      if (!limits.customCss) {
        data.customCss = null;
      }
      if (!limits.cartBlocking) {
        data.blockCartOnInvalid = false;
        data.blockCheckoutInCart = false;
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
        blockCartOnInvalid: false,
        blockCheckoutInCart: false,
        showSocialProof: true,
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
  blockCartOnInvalid: boolean;
  blockCheckoutInCart: boolean;
  showSocialProof: boolean;
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
  blockCartOnInvalid: false,
  blockCheckoutInCart: false,
  showSocialProof: true,
  borderRadius: "8",
  customCss: "",
};

// ── Scope custom CSS for admin preview — prefix selectors with #wid ─────────
function scopeAdminCss(rawCss: string | null | undefined, wid: string): string {
  if (!rawCss) return "";
  const css = rawCss.replace(/<\/style>/gi, "");
  let result = "";
  let remaining = css;
  while (remaining.length > 0) {
    const openBrace = remaining.indexOf("{");
    if (openBrace === -1) break;
    const closeBrace = remaining.indexOf("}", openBrace);
    if (closeBrace === -1) break;
    const selector = remaining.substring(0, openBrace).trim();
    const body = remaining.substring(openBrace + 1, closeBrace);
    remaining = remaining.substring(closeBrace + 1);
    if (selector.startsWith("@")) {
      result += selector + "{" + body + "}";
    } else if (selector) {
      const prefixed = selector.split(",").map(s => {
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
  const p = cfg.primaryColor;
  const s = cfg.successColor;
  return (
    W + " .zcc-result-icon{flex-shrink:0;width:24px;height:24px;display:flex;align-items:center;justify-content:center}" +
    W + " .zcc-result-icon svg{width:22px;height:22px}" +
    W + " .zcc-result-content{flex:1;min-width:0}" +
    // Compact single-line meta rows — tight spacing
    W + " .zcc-meta{margin-top:4px;font-size:13px;display:flex;align-items:center;gap:6px;color:" + cfg.textColor + ";line-height:1.3}" +
    W + " .zcc-meta svg{flex-shrink:0;width:14px;height:14px;display:block}" +
    W + " .zcc-meta strong{font-weight:700}" +
    // COD as compact inline pill
    W + " .zcc-cod{margin-top:6px;display:inline-flex;align-items:center;gap:5px;border-radius:20px;padding:3px 10px;font-size:12px;font-weight:600}" +
    W + " .zcc-cod--available{background:" + s + "10;border:1px solid " + s + "20;color:" + s + "}" +
    W + " .zcc-cod--unavailable{background:#d72c0d10;border:1px solid #d72c0d20;color:#d72c0d}" +
    W + " .zcc-wl-title{font-size:13px;font-weight:700;color:" + cfg.textColor + ";margin-bottom:10px}" +
    // Confirmed header — compact
    W + " .zcc-confirmed-header{display:flex;align-items:center;gap:8px;padding:10px 14px;background:" + s + "06;border:1px solid " + s + "15;border-radius:10px;font-size:13.5px;font-weight:500;color:" + cfg.textColor + "}" +
    W + " .zcc-change-link{margin-left:auto;color:" + p + ";font-size:12px;cursor:pointer;font-weight:600}" +
    // Compact inline timeline — single row
    W + " .zcc-timeline{display:flex;align-items:center;margin-top:10px;padding:10px 12px;background:" + p + "05;border-radius:10px;gap:0;justify-content:center}" +
    W + " .zcc-timeline-step{display:flex;flex-direction:column;align-items:center;flex:1;gap:2px}" +
    W + " .zcc-timeline-icon{width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:#fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.06)}" +
    W + " .zcc-timeline-icon svg{width:18px;height:18px;display:block}" +
    W + " .zcc-timeline-step--active .zcc-timeline-icon{box-shadow:0 1px 6px " + p + "18}" +
    W + " .zcc-timeline-label{font-size:10px;font-weight:700;color:" + cfg.textColor + ";text-transform:uppercase;letter-spacing:0.3px}" +
    W + " .zcc-timeline-date{font-size:10px;color:#6b7280}" +
    W + " .zcc-timeline-line{height:2px;width:16px;background:" + p + "25;flex-shrink:0}"
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
    W + "{background:" + cfg.backgroundColor + ";color:" + cfg.textColor + ";padding:0;border:none;box-shadow:none;max-width:480px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;box-sizing:border-box}" +
    W + " *{box-sizing:border-box}" +
    W + " .zcc-heading{font-size:15px;font-weight:700;letter-spacing:-0.01em;margin:0;color:" + cfg.textColor + ";display:flex;align-items:center;gap:8px;padding-bottom:12px;border-bottom:1px solid rgba(0,0,0,0.06);margin-bottom:12px}" +
    W + " .zcc-heading-icon{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg," + p + "18," + p + "08);flex-shrink:0}" +
    W + " .zcc-heading-icon svg{width:14px;height:14px}" +
    W + " .zcc-search-bar{display:flex;flex-direction:row;gap:10px;align-items:stretch}" +
    W + " .zcc-input{flex:1;min-width:0;padding:12px 16px;font-size:14px;border:1.5px solid #e0e0e0;border-radius:" + btnRadius + ";outline:none;background:#fafbfb;color:" + cfg.textColor + ";transition:border-color 0.2s,box-shadow 0.2s}" +
    W + " .zcc-input:focus{border-color:" + p + ";box-shadow:0 0 0 3px " + p + "15}" +
    W + " .zcc-input::placeholder{color:#9ca3af}" +
    W + " .zcc-btn{flex-shrink:0;white-space:nowrap;background:" + p + ";color:#fff;border:none;padding:12px 24px;font-size:14px;font-weight:600;cursor:pointer;border-radius:" + btnRadius + ";box-shadow:0 2px 8px " + p + "25;transition:filter 0.2s,box-shadow 0.2s,transform 0.2s;display:flex;align-items:center;justify-content:center;gap:6px}" +
    W + " .zcc-btn:hover{filter:brightness(1.06);box-shadow:0 4px 14px " + p + "40;transform:translateY(-1px)}" +
    W + " .zcc-btn:active{filter:brightness(0.95);transform:translateY(0)}" +
    W + " .zcc-btn:disabled{opacity:.6;cursor:not-allowed;transform:none;box-shadow:none;filter:none}" +
    W + " .zcc-btn--error{background:" + e + "10;color:" + e + ";font-weight:700;box-shadow:none}" +
    W + " .zcc-result{margin-top:10px;padding:12px 14px;border-radius:12px;font-size:13.5px;line-height:1.5;animation:zcc-slide-in 0.4s cubic-bezier(0.34,1.56,0.64,1);display:flex;gap:10px;align-items:flex-start;justify-content:space-between}" +
    W + " .zcc-result.ok{background:" + s + "08;border:1px solid " + s + "18}" +
    W + " .zcc-result.fail{background:" + e + "08;border:1px solid " + e + "18}" +
    W + " .zcc-wl{margin-top:10px;padding:14px;background:linear-gradient(135deg,#f8fafc,#f1f5f9);border-radius:12px;border:1px solid #e2e8f0}" +
    W + " .zcc-wl-input{border-radius:8px;border:1.5px solid #dee2e6;padding:10px 14px;width:100%;display:block;margin-bottom:6px;outline:none;font-size:13px;transition:border-color 0.2s;background:#fff}" +
    W + " .zcc-wl-btn{border-radius:50px;background:" + p + ";color:#fff;padding:10px;width:100%;font-weight:600;border:none;cursor:pointer;font-size:13px;transition:filter 0.2s,transform 0.2s}" +
    W + " .zcc-wl-btn:hover{filter:brightness(1.06);transform:translateY(-1px)}" +
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
      {/* Mock storefront page */}
      <div
        style={{
          position: "relative",
          minHeight: "340px",
          background: "linear-gradient(180deg, #fafafa 0%, #f1f1f1 100%)",
          borderRadius: "10px",
          overflow: "hidden",
        }}
      >
        {/* Realistic product page skeleton */}
        <div style={{ padding: "16px", display: "flex", gap: "14px" }}>
          {/* Product image placeholder */}
          <div style={{ width: 120, height: 120, borderRadius: 10, background: "linear-gradient(135deg, #f0f0f0, #e8e8e8)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5" style={{ width: 32, height: 32 }}>
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-3.086-3.086a2 2 0 00-2.828 0L6 21"/>
            </svg>
          </div>
          {/* Product details */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ width: "85%", height: 12, background: "#e0e0e0", borderRadius: 4, marginBottom: 8 }} />
            <div style={{ width: "40%", height: 10, background: "#d4d4d4", borderRadius: 4, marginBottom: 6 }} />
            <div style={{ display: "flex", gap: 3, marginBottom: 12 }}>
              {[1,2,3,4,5].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: i <= 4 ? "#fbbf24" : "#e5e7eb" }} />)}
            </div>
            <div style={{ height: 36, background: "#222", borderRadius: 8, marginBottom: 8 }} />
            <div style={{ height: 32, border: "1.5px solid #ddd", borderRadius: 8 }} />
          </div>
        </div>

        {/* Floating UI anchored bottom-right */}
        <div
          style={{
            position: "absolute",
            bottom: 14,
            right: 14,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 10,
            zIndex: 2,
          }}
        >
          {/* Panel */}
          {panelOpen && (
            <div
              style={{
                background: cfg.backgroundColor,
                borderRadius: 16,
                boxShadow: "0 16px 48px rgba(0,0,0,.14), 0 4px 16px rgba(0,0,0,.06)",
                width: 320,
                maxWidth: "calc(100% - 16px)",
                overflow: "hidden",
                animation: "zcc-slide-in 0.35s cubic-bezier(0.34,1.56,0.64,1)",
              }}
            >
              {/* Panel header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 16px",
                  background: `linear-gradient(135deg, ${cfg.primaryColor}08, ${cfg.primaryColor}03)`,
                  borderBottom: "1px solid rgba(0,0,0,0.06)",
                }}
              >
                <div
                  style={{
                    fontSize: 14,
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
                  onClick={() => setPanelOpen(false)}
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
              {/* Panel body — compact */}
              <div style={{ padding: "10px 14px 14px" }}>
                <style dangerouslySetInnerHTML={{ __html: `#${wid} .zcc-heading{display:none}` }} />
                {widgetHtml}
              </div>
            </div>
          )}

          {/* Trigger button — circular icon only */}
          <button
            type="button"
            onClick={() => setPanelOpen(!panelOpen)}
            style={{
              background: cfg.primaryColor,
              color: "#fff",
              border: "none",
              borderRadius: "50%",
              width: 52,
              height: 52,
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              boxShadow: `0 6px 20px ${cfg.primaryColor}40, 0 2px 6px rgba(0,0,0,0.1)`,
              transition: "transform 0.2s ease, box-shadow 0.2s ease",
              position: "relative" as const,
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
            </svg>
          </button>
        </div>
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
            {cfg.heading}
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
}: {
  cfg: WidgetConfig;
  previewState: "idle" | "success" | "error" | "notfound";
  widgetFullCustom: boolean;
}) {
  const wid = "zcc-admin-preview";

  // Apply the same plan enforcement the API applies so the preview matches
  // exactly what will render on the storefront.
  const effectiveCfg: WidgetConfig = useMemo(() => {
    if (widgetFullCustom) return cfg;
    return {
      ...cfg,
      primaryColor: DEFAULTS.primaryColor,
      successColor: DEFAULTS.successColor,
      errorColor: DEFAULTS.errorColor,
      backgroundColor: DEFAULTS.backgroundColor,
      textColor: DEFAULTS.textColor,
      position: DEFAULTS.position,
    };
  }, [cfg, widgetFullCustom]);

  const css = useMemo(() => buildWidgetCss(wid, effectiveCfg), [wid, effectiveCfg]);

  const resultMessage =
    previewState === "success" ? cfg.successMessage :
    previewState === "error" ? cfg.errorMessage :
    previewState === "notfound" ? cfg.notFoundMessage : null;

  // SVG icons as inline JSX — consistent outlined/stroke style
  // Use effectiveCfg for colors so the preview matches what storefront serves
  const iconStyle = { width: 16, height: 16, display: "block" as const };
  const metaIconStyle = { width: 14, height: 14, display: "block" as const, opacity: 0.7 };
  const timelineIconStyle = { width: 18, height: 18, display: "block" as const };
  const pinIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke={effectiveCfg.primaryColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
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
  const xSmallIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12, display: "block" as const }}>
      <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
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
  const bagIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke={effectiveCfg.primaryColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={timelineIconStyle}>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>
    </svg>
  );
  const shipTruckIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke={effectiveCfg.primaryColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={timelineIconStyle}>
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 13.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>
    </svg>
  );
  const packageIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke={effectiveCfg.primaryColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={timelineIconStyle}>
      <path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>
    </svg>
  );
  const widgetHtml = (
    <div id={wid}>
      <div className="zcc-heading">
        <span className="zcc-heading-icon">{pinIcon}</span>
        <span>{cfg.heading}</span>
      </div>

      {/* Success state: show "Delivering to" confirmed view instead of search bar */}
      {previewState === "success" ? (
        <div className="zcc-confirmed">
          <div className="zcc-confirmed-header">
            <span style={{ display: "inline-flex", alignItems: "center" }}>{checkCircleIcon}</span>
            <span>Delivering to <strong>10001</strong></span>
            <span className="zcc-change-link">Change</span>
          </div>
        </div>
      ) : (
        /* All other states: show search bar */
        <div className="zcc-search-bar">
          {(previewState === "error" || previewState === "notfound") ? (
            <input
              className="zcc-input"
              type="text"
              value="380007"
              readOnly
              style={{ color: effectiveCfg.errorColor }}
            />
          ) : (
            <input
              className="zcc-input"
              type="text"
              placeholder={cfg.placeholder}
              readOnly
            />
          )}
          {(previewState === "error" || previewState === "notfound") ? (
            <button className="zcc-btn zcc-btn--error" type="button" style={{ gap: 6 }}>
              {cfg.buttonText.toUpperCase()} {xSmallIcon}
            </button>
          ) : (
            <button className="zcc-btn" type="button">
              {cfg.buttonText}
            </button>
          )}
        </div>
      )}

      {/* Success result — compact card with emoji accent */}
      {previewState === "success" && (
        <>
          <div className="zcc-result ok">
            <div className="zcc-result-content">
              <div style={{ fontWeight: 600, color: effectiveCfg.successColor, marginBottom: 4 }}>
                {cfg.successMessage}
              </div>
              {cfg.showEta && (
                <div className="zcc-meta">
                  {truckIcon}
                  <span>Get it by <strong>Thu, Mar 20</strong>{cfg.showCutoffTime ? " · Order within " : ""}{cfg.showCutoffTime && <strong>5h 30m</strong>}</span>
                </div>
              )}
              {!cfg.showEta && cfg.showCutoffTime && (
                <div className="zcc-meta">
                  {clockIcon}
                  <span>Order within <strong>5h 30m</strong> for same-day</span>
                </div>
              )}
              {cfg.showDeliveryDays && (
                <div className="zcc-meta">
                  {calendarIcon}
                  <span>Mon · Tue · Wed · Thu · Fri</span>
                </div>
              )}
              {(cfg.showCod || cfg.showReturnPolicy) && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" as const }}>
                  {cfg.showCod && (
                    <div className="zcc-cod zcc-cod--available">
                      {cardIcon} COD Available
                    </div>
                  )}
                  {cfg.showReturnPolicy && (
                    <span style={{ fontSize: 12, color: "#6b7280", display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {refreshIcon} Returns accepted
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          {/* Compact inline delivery timeline */}
          {cfg.showEta && (
            <div className="zcc-timeline">
              <div className="zcc-timeline-step zcc-timeline-step--active">
                <div className="zcc-timeline-icon">{bagIcon}</div>
                <div className="zcc-timeline-label">Order</div>
                <div className="zcc-timeline-date">Today</div>
              </div>
              <div className="zcc-timeline-line" />
              <div className="zcc-timeline-step zcc-timeline-step--active">
                <div className="zcc-timeline-icon">{shipTruckIcon}</div>
                <div className="zcc-timeline-label">Ships</div>
                <div className="zcc-timeline-date">Mar 19</div>
              </div>
              <div className="zcc-timeline-line" />
              <div className="zcc-timeline-step">
                <div className="zcc-timeline-icon">{packageIcon}</div>
                <div className="zcc-timeline-label">Deliver</div>
                <div className="zcc-timeline-date">Mar 21</div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Error / Not Found result — compact */}
      {(previewState === "error" || previewState === "notfound") && (
        <div className="zcc-result fail">
          <div className="zcc-result-content">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flexShrink: 0, display: "inline-flex" }}>{xCircleIcon}</span>
              <span>
                <strong style={{ color: effectiveCfg.errorColor }}>Sorry,</strong>{" "}
                {resultMessage ? resultMessage.replace(/^Sorry,?\s*/i, "") : "We don't deliver to this area yet."}
              </span>
            </div>
            {cfg.showWaitlistOnFailure && (
              <div className="zcc-wl">
                <div className="zcc-wl-title">Get notified when we deliver here</div>
                <input className="zcc-wl-input" type="email" placeholder="Your email" readOnly />
                <button className="zcc-wl-btn" type="button">Join Waitlist</button>
              </div>
            )}
          </div>
        </div>
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
  const [blockCartOnInvalid, setBlockCartOnInvalid] = useState(c.blockCartOnInvalid ?? false);
  const [blockCheckoutInCart, setBlockCheckoutInCart] = useState(c.blockCheckoutInCart ?? false);
  const [showSocialProof, setShowSocialProof] = useState(c.showSocialProof ?? true);
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
  const handleBlockCartOnInvalidChange = useCallback((v: boolean) => { setBlockCartOnInvalid(v); mark(); }, [mark]);
  const handleBlockCheckoutInCartChange = useCallback((v: boolean) => { setBlockCheckoutInCart(v); mark(); }, [mark]);
  const handleShowSocialProofChange = useCallback((v: boolean) => { setShowSocialProof(v); mark(); }, [mark]);
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
    fd.set("blockCartOnInvalid", String(blockCartOnInvalid));
    fd.set("blockCheckoutInCart", String(blockCheckoutInCart));
    fd.set("showSocialProof", String(showSocialProof));
    fd.set("borderRadius", borderRadius);
    fd.set("customCss", customCss);
    fetcher.submit(fd, { method: "POST" });
    shopify.toast.show("Widget settings saved");
  }, [
    position, primaryColor, successColor, errorColor, backgroundColor,
    textColor, heading, placeholder, buttonText, successMessage, errorMessage,
    notFoundMessage, showEta, showZone, showWaitlistOnFailure, showCod,
    showReturnPolicy, showCutoffTime, showDeliveryDays, blockCartOnInvalid,
    blockCheckoutInCart, showSocialProof, borderRadius, customCss,
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
    setBlockCartOnInvalid(DEFAULTS.blockCartOnInvalid);
    setBlockCheckoutInCart(DEFAULTS.blockCheckoutInCart);
    setShowSocialProof(DEFAULTS.showSocialProof);
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
    showReturnPolicy, showCutoffTime, showDeliveryDays, blockCartOnInvalid,
    blockCheckoutInCart, showSocialProof, borderRadius, customCss,
  }), [
    position, primaryColor, successColor, errorColor, backgroundColor,
    textColor, heading, placeholder, buttonText, successMessage, errorMessage,
    notFoundMessage, showEta, showZone, showWaitlistOnFailure, showCod,
    showReturnPolicy, showCutoffTime, showDeliveryDays, blockCartOnInvalid,
    blockCheckoutInCart, showSocialProof, borderRadius, customCss,
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
    setBlockCartOnInvalid(c.blockCartOnInvalid ?? false);
    setBlockCheckoutInCart(c.blockCheckoutInCart ?? false);
    setShowSocialProof(c.showSocialProof ?? true);
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
                      <div style={{ flex: 1, minWidth: "140px" }}>
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
                      </div>
                      <div style={{ flex: 1, minWidth: "140px" }}>
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
                      </div>
                    </InlineStack>
                    <InlineStack gap="300" wrap>
                      <div style={{ flex: 1, minWidth: "140px" }}>
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
                      </div>
                      <div style={{ flex: 1, minWidth: "140px" }}>
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
                      </div>
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
                    {!limits.cartBlocking && (
                      <Banner tone="info">
                        <Text as="p" variant="bodySm">
                          Upgrade to Pro to enable cart and checkout blocking for unserviceable ZIP codes.{" "}
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
                      helpText="Write plain CSS using widget classes (.zcc-heading, .zcc-btn, .zcc-input, .zcc-result, .zcc-search-bar, .zcc-meta). All selectors are automatically scoped to the widget only — your CSS won't affect the rest of your store."
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
                      border: "1px solid #e2e8f0",
                      borderRadius: 12,
                      overflow: "hidden",
                      background: "#fff",
                    }}>
                      {/* Browser chrome */}
                      <div style={{
                        height: 32,
                        background: "#f8fafc",
                        borderBottom: "1px solid #e2e8f0",
                        display: "flex",
                        alignItems: "center",
                        padding: "0 12px",
                        gap: 6,
                      }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff5f57" }} />
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#febc2e" }} />
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#28c840" }} />
                      </div>
                      {/* Dot-grid preview area */}
                      <div style={{
                        padding: 20,
                        background: "radial-gradient(circle, #e2e8f0 1px, transparent 1px)",
                        backgroundSize: "20px 20px",
                        backgroundColor: "#f8fafc",
                      }}>
                        <WidgetPreview cfg={previewCfg} previewState={previewState} widgetFullCustom={limits.widgetFullCustom} />
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

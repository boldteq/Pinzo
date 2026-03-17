/**
 * Public API endpoint — joins a customer to the waitlist from the storefront widget.
 *
 * Called from the theme app extension block when a zip code check fails and
 * the merchant has enabled the waitlist feature.
 *
 * POST /api/waitlist
 * Body: { shop: string, zip: string, email: string }
 *
 * Response:
 *   200 { success: true, message: "..." }
 *   400 { error: "..." }
 *   500 { error: "..." }
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { getShopSubscription } from "../billing.server";
import { UNLIMITED } from "../plans";
import { normalizeZipCode } from "../utils/zip";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// Handle CORS preflight
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: CORS_HEADERS,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  let shop: string | null = null;
  let zip: string | null = null;
  let email: string | null = null;
  let name: string | null = null;

  try {
    const body = await request.json();
    shop = body?.shop ?? null;
    zip = body?.zip ?? null;
    email = body?.email ?? null;
    name = body?.name ?? null;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  if (!shop || !zip || !email) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: shop, zip, email" }),
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Validate shop is a real myshopify.com domain (prevents cross-shop enumeration)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop) || shop.length > 100) {
    return new Response(
      JSON.stringify({ error: "Invalid shop parameter" }),
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Enforce input length limits to prevent abuse
  if (zip.length > 20 || email.length > 254) {
    return new Response(
      JSON.stringify({ error: "Invalid input" }),
      { status: 400, headers: CORS_HEADERS },
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(
      JSON.stringify({ error: "Invalid email address" }),
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Check if shop's plan allows waitlist
  try {
    const subscription = await getShopSubscription(shop);
    if (subscription.limits.maxWaitlist === 0) {
      return new Response(
        JSON.stringify({ error: "Waitlist is not available on this store's plan" }),
        { status: 400, headers: CORS_HEADERS },
      );
    }
    // Enforce entry limit for Starter plan
    if (subscription.limits.maxWaitlist < UNLIMITED) {
      const currentCount = await db.waitlistEntry.count({ where: { shop } });
      if (currentCount >= subscription.limits.maxWaitlist) {
        return new Response(
          JSON.stringify({ error: "Waitlist is currently full. Please try again later." }),
          { status: 400, headers: CORS_HEADERS },
        );
      }
    }
  } catch {
    // If subscription check fails, deny the request to prevent plan bypass
    return new Response(
      JSON.stringify({ error: "Unable to verify subscription. Please try again later." }),
      { status: 503, headers: CORS_HEADERS },
    );
  }

  try {
    await db.waitlistEntry.upsert({
      where: {
        shop_email_zipCode: {
          shop,
          email,
          zipCode: normalizeZipCode(zip),
        },
      },
      create: {
        shop,
        email,
        name: name ? name.trim().substring(0, 100) : null,
        zipCode: normalizeZipCode(zip),
        status: "waiting",
      },
      update: {
        status: "waiting",
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "You've been added to the waitlist!",
      }),
      { status: 200, headers: CORS_HEADERS },
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "Failed to join waitlist. Please try again." }),
      { status: 500, headers: CORS_HEADERS },
    );
  }
};

/**
 * Centralized Resend email service.
 *
 * All send functions return `true` on success, `false` on failure — they never
 * throw. This lets callers fire-and-forget without wrapping in try/catch.
 */
import { Resend } from "resend";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmailOptions {
  /** Display name in the From field (e.g. "Cool Store"). Defaults to shopDisplayName. */
  senderName?: string | null;
  /** Cached Shopify store display name (from ShopSettings.shopName). Falls back to myshopify slug. */
  shopDisplayName?: string | null;
  /** Reply-to email for customer-facing emails. If empty, no reply-to header is added. */
  replyTo?: string | null;
}

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let client: Resend | null = null;

function getClient(): Resend | null {
  if (client) return client;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set — emails will be skipped");
    return null;
  }
  client = new Resend(apiKey);
  return client;
}

/**
 * Returns true if the Resend API key is configured and the client can be
 * initialized. Callers use this to show actionable diagnostics in the UI
 * (e.g. "API key missing" vs "send failed") without attempting a live send.
 */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

// Guard: RESEND_API_KEY configured but RESEND_FROM_EMAIL missing → mis-configuration
// (both unset → email skipped silently, which is fine for local dev)
if (process.env.RESEND_API_KEY && !process.env.RESEND_FROM_EMAIL) {
  throw new Error(
    "[email] RESEND_API_KEY is set but RESEND_FROM_EMAIL is not configured. " +
      "Set RESEND_FROM_EMAIL to the verified sender address (e.g. noreply@yourdomain.com).",
  );
}

function getRawFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL || "noreply@example.com";
}

function shopFallbackName(shop: string, options?: EmailOptions): string {
  return options?.shopDisplayName?.trim() || shop.replace(".myshopify.com", "");
}

/**
 * Build the full From address with display name.
 *
 * - Custom sender name set:  "Cool Store via Pinzo <noreply@boldteq.app>"
 * - No custom name:          "cool-store via Pinzo <noreply@boldteq.app>"
 */
function buildFrom(shop: string, options?: EmailOptions): string {
  const displayName = options?.senderName?.trim() || shopFallbackName(shop, options);
  return `${displayName} via Pinzo <${getRawFromEmail()}>`;
}

/**
 * Build optional reply_to field. Returns undefined when not configured
 * so it can be spread into the Resend payload without adding an empty header.
 */
function buildReplyTo(options?: EmailOptions): { reply_to: string } | Record<string, never> {
  const replyTo = options?.replyTo?.trim();
  if (replyTo) return { reply_to: replyTo };
  return {};
}

/**
 * Wrap email body content in a branded layout with Pinzo logo header and store name.
 */
const APP_URL = process.env.SHOPIFY_APP_URL || "https://zip-code-checker-production-b1a0.up.railway.app";

function emailLayout(storeName: string, body: string): string {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;background:#ffffff">
      <div style="padding:24px 24px 16px;border-bottom:1px solid #e5e7eb;text-align:center">
        <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">
          <tr>
            <td style="vertical-align:middle;padding-right:10px">
              <img src="${APP_URL}/pinzo-logo.svg" alt="Pinzo" width="36" height="36" style="display:block;border-radius:8px" />
            </td>
            <td style="vertical-align:middle">
              <span style="font-size:20px;font-weight:700;color:#1a1a1a;letter-spacing:-0.3px">Pinzo</span>
            </td>
          </tr>
        </table>
        <p style="margin:8px 0 0;font-size:13px;color:#6b7280">${storeName}</p>
      </div>
      <div style="padding:24px">
        ${body}
      </div>
      <div style="padding:16px 24px;border-top:1px solid #e5e7eb;text-align:center">
        <p style="margin:0;font-size:12px;color:#9ca3af">Powered by <span style="color:#008060;font-weight:600">Pinzo</span></p>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// 1. Waitlist Confirmation  (App → Customer)
// ---------------------------------------------------------------------------

export async function sendWaitlistConfirmation(
  to: string,
  zipCode: string,
  shop: string,
  options?: EmailOptions,
): Promise<boolean> {
  const resend = getClient();
  if (!resend) return false;

  const name = options?.senderName?.trim() || shopFallbackName(shop, options);

  try {
    await resend.emails.send({
      from: buildFrom(shop, options),
      to,
      subject: `You're on the waitlist — ${name}`,
      html: emailLayout(name, `
          <h2 style="margin:0 0 16px;color:#1a1a1a">You're on the waitlist!</h2>
          <p style="color:#374151;line-height:1.6">Thanks for signing up. We'll let you know as soon as delivery is available to <strong>${zipCode}</strong>.</p>
          <p style="color:#6b7280;font-size:13px;margin-top:24px">— ${name}</p>
      `),
      text: `You're on the waitlist!\n\nThanks for signing up. We'll let you know as soon as delivery is available to ${zipCode}.\n\n— ${name}`,
      ...buildReplyTo(options),
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send waitlist confirmation:", error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 2. Merchant Alert  (App → Merchant)
// ---------------------------------------------------------------------------

export async function sendMerchantWaitlistAlert(
  to: string,
  customerEmail: string,
  zipCode: string,
  shop: string,
  options?: EmailOptions,
): Promise<boolean> {
  const resend = getClient();
  if (!resend) return false;

  const name = options?.senderName?.trim() || shopFallbackName(shop, options);

  try {
    await resend.emails.send({
      from: buildFrom(shop, options),
      to,
      subject: `New waitlist signup: ${zipCode}`,
      html: emailLayout(name, `
          <h2 style="margin:0 0 16px;color:#1a1a1a">New waitlist signup</h2>
          <p style="color:#374151;line-height:1.6">A customer just joined the waitlist for ZIP code <strong>${zipCode}</strong>.</p>
          <table style="margin:16px 0;border-collapse:collapse">
            <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Email</td><td style="color:#1a1a1a">${customerEmail}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#6b7280">ZIP Code</td><td style="color:#1a1a1a">${zipCode}</td></tr>
          </table>
          <p style="color:#6b7280;font-size:13px">You can manage the waitlist from your <strong>${name}</strong> admin dashboard.</p>
      `),
      text: `New waitlist signup\n\nA customer (${customerEmail}) just joined the waitlist for ZIP code ${zipCode}.\n\nManage the waitlist from your ${name} admin dashboard.`,
      ...buildReplyTo(options),
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send merchant waitlist alert:", error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 3. ZIP Available Notification  (App → Customer)
// ---------------------------------------------------------------------------

export async function sendZipAvailableNotification(
  to: string,
  zipCode: string,
  shop: string,
  shopUrl: string,
  options?: EmailOptions,
): Promise<boolean> {
  const resend = getClient();
  if (!resend) {
    console.warn("[email] sendZipAvailableNotification skipped — Resend client not initialized (RESEND_API_KEY missing)");
    return false;
  }

  const name = options?.senderName?.trim() || shopFallbackName(shop, options);

  try {
    await resend.emails.send({
      from: buildFrom(shop, options),
      to,
      subject: `Great news! We now deliver to ${zipCode}`,
      html: emailLayout(name, `
          <h2 style="margin:0 0 16px;color:#1a1a1a">Great news!</h2>
          <p style="color:#374151;line-height:1.6">We're excited to let you know that delivery is now available to ZIP code <strong>${zipCode}</strong>.</p>
          <p style="margin-top:16px"><a href="${shopUrl}" style="display:inline-block;padding:12px 24px;background:#008060;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:15px">Shop Now</a></p>
          <p style="color:#6b7280;font-size:13px;margin-top:24px">— ${name}</p>
      `),
      text: `Great news!\n\nDelivery is now available to ZIP code ${zipCode}. Visit ${shopUrl} to place your order.\n\n— ${name}`,
      ...buildReplyTo(options),
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send ZIP available notification:", error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 4. GDPR Data Request  (App → Customer)
// ---------------------------------------------------------------------------

export interface GdprDataRow {
  zipCode: string;
  status: string;
  createdAt: Date;
}

/**
 * Sends the customer a JSON export of all data we store about them.
 * Required for Shopify App Store compliance (customers/data_request webhook).
 */
export async function sendGdprDataRequestExport(
  to: string,
  shop: string,
  rows: GdprDataRow[],
): Promise<boolean> {
  const resend = getClient();
  if (!resend) {
    console.warn(
      "[email] sendGdprDataRequestExport skipped — Resend not configured; shop=%s customer=%s",
      shop,
      to,
    );
    return false;
  }

  const name = shopFallbackName(shop);
  const rowsJson = JSON.stringify(rows, null, 2);
  const tableHtml = rows.length
    ? `<table style="width:100%;border-collapse:collapse;margin:16px 0">
        <thead><tr>
          <th style="text-align:left;padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:12px;text-transform:uppercase">ZIP</th>
          <th style="text-align:left;padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:12px;text-transform:uppercase">Status</th>
          <th style="text-align:left;padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:12px;text-transform:uppercase">Joined</th>
        </tr></thead>
        <tbody>
          ${rows
            .map(
              (r) =>
                `<tr><td style="padding:8px;border-bottom:1px solid #f3f4f6">${r.zipCode}</td><td style="padding:8px;border-bottom:1px solid #f3f4f6">${r.status}</td><td style="padding:8px;border-bottom:1px solid #f3f4f6">${new Date(r.createdAt).toISOString().slice(0, 10)}</td></tr>`,
            )
            .join("")}
        </tbody>
      </table>`
    : `<p style="color:#374151">We have no stored data associated with this email address.</p>`;

  try {
    await resend.emails.send({
      from: buildFrom(shop),
      to,
      subject: `Your data export from ${name}`,
      html: emailLayout(
        name,
        `
          <h2 style="margin:0 0 16px;color:#1a1a1a">Your data export</h2>
          <p style="color:#374151;line-height:1.6">You requested a copy of the personal data ${name} stores about you. Below is every record tied to this email address.</p>
          ${tableHtml}
          <p style="color:#6b7280;font-size:13px;margin-top:24px">Machine-readable copy:</p>
          <pre style="background:#f9fafb;padding:12px;border-radius:6px;font-size:12px;overflow:auto;color:#111827">${rowsJson.replace(/</g, "&lt;")}</pre>
          <p style="color:#6b7280;font-size:13px;margin-top:24px">If you believe this is incomplete or would like the data removed, reply to this email and we will respond within 30 days.</p>
        `,
      ),
      text: `Your data export from ${name}\n\nRecords for ${to}:\n${rowsJson}\n\nIf anything looks wrong, reply to this email.`,
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send GDPR data export:", error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 5. Test Email  (Settings page)
// ---------------------------------------------------------------------------

export async function sendTestEmail(
  to: string,
  options?: EmailOptions,
  shop?: string,
): Promise<boolean> {
  const resend = getClient();
  if (!resend) return false;

  const name = options?.senderName?.trim() || (shop ? shopFallbackName(shop, options) : "Your Store");

  try {
    await resend.emails.send({
      from: buildFrom(shop || "test-store.myshopify.com", options),
      to,
      subject: "Pinzo — Test Email",
      html: emailLayout(name, `
          <h2 style="margin:0 0 16px;color:#1a1a1a">Test email received!</h2>
          <p style="color:#374151;line-height:1.6">Your email integration is working correctly.</p>
          <p style="margin-top:16px;color:#374151"><strong>From:</strong> ${name} via Pinzo &lt;${getRawFromEmail()}&gt;</p>
          ${options?.replyTo ? `<p style="color:#374151"><strong>Reply-To:</strong> ${options.replyTo}</p>` : '<p style="color:#374151"><strong>Reply-To:</strong> <em>Not set</em></p>'}
          <p style="color:#6b7280;font-size:13px;margin-top:24px">You will receive notifications when customers join your waitlist.</p>
      `),
      text: `Test email received!\n\nYour email integration is working correctly.\n\nFrom: ${name} via Pinzo <${getRawFromEmail()}>\nReply-To: ${options?.replyTo || "Not set"}\n\nYou will receive notifications when customers join your waitlist.`,
      ...buildReplyTo(options),
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send test email:", error);
    return false;
  }
}

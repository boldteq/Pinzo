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
  /** Display name in the From field (e.g. "Cool Store"). Defaults to shop name + "via Pinzo". */
  senderName?: string | null;
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

function getRawFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL || "noreply@example.com";
}

function shopDisplayName(shop: string): string {
  return shop.replace(".myshopify.com", "");
}

/**
 * Build the full From address with display name.
 *
 * - Custom sender name set:  "Cool Store via Pinzo <noreply@boldteq.app>"
 * - No custom name:          "cool-store via Pinzo <noreply@boldteq.app>"
 */
function buildFrom(shop: string, options?: EmailOptions): string {
  const displayName = options?.senderName?.trim() || shopDisplayName(shop);
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

  const name = options?.senderName?.trim() || shopDisplayName(shop);

  try {
    await resend.emails.send({
      from: buildFrom(shop, options),
      to,
      subject: `You're on the waitlist — ${name}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
          <h2 style="margin:0 0 16px">You're on the waitlist!</h2>
          <p>Thanks for signing up. We'll let you know as soon as delivery is available to <strong>${zipCode}</strong>.</p>
          <p style="color:#666;font-size:13px;margin-top:24px">— ${name}</p>
        </div>
      `,
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

  const name = options?.senderName?.trim() || shopDisplayName(shop);

  try {
    await resend.emails.send({
      from: buildFrom(shop, options),
      to,
      subject: `New waitlist signup: ${zipCode}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
          <h2 style="margin:0 0 16px">New waitlist signup</h2>
          <p>A customer just joined the waitlist for ZIP code <strong>${zipCode}</strong>.</p>
          <table style="margin:16px 0;border-collapse:collapse">
            <tr><td style="padding:4px 12px 4px 0;color:#666">Email</td><td>${customerEmail}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">ZIP Code</td><td>${zipCode}</td></tr>
          </table>
          <p style="color:#666;font-size:13px">You can manage the waitlist from your <strong>${name}</strong> admin dashboard.</p>
        </div>
      `,
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
  if (!resend) return false;

  const name = options?.senderName?.trim() || shopDisplayName(shop);

  try {
    await resend.emails.send({
      from: buildFrom(shop, options),
      to,
      subject: `Great news! We now deliver to ${zipCode}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
          <h2 style="margin:0 0 16px">Great news!</h2>
          <p>We're excited to let you know that delivery is now available to ZIP code <strong>${zipCode}</strong>.</p>
          <p><a href="${shopUrl}" style="display:inline-block;padding:10px 20px;background:#008060;color:#fff;text-decoration:none;border-radius:4px;margin-top:8px">Shop Now</a></p>
          <p style="color:#666;font-size:13px;margin-top:24px">— ${name}</p>
        </div>
      `,
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
// 4. Test Email  (Settings page)
// ---------------------------------------------------------------------------

export async function sendTestEmail(
  to: string,
  options?: EmailOptions,
  shop?: string,
): Promise<boolean> {
  const resend = getClient();
  if (!resend) return false;

  const name = options?.senderName?.trim() || (shop ? shopDisplayName(shop) : "Your Store");

  try {
    await resend.emails.send({
      from: buildFrom(shop || "test-store.myshopify.com", options),
      to,
      subject: "Pinzo — Test Email",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
          <h2 style="margin:0 0 16px">Test email received!</h2>
          <p>Your email integration is working correctly.</p>
          <p style="margin-top:16px"><strong>From:</strong> ${name} via Pinzo &lt;${getRawFromEmail()}&gt;</p>
          ${options?.replyTo ? `<p><strong>Reply-To:</strong> ${options.replyTo}</p>` : "<p><strong>Reply-To:</strong> <em>Not set</em></p>"}
          <p style="color:#666;font-size:13px;margin-top:24px">You will receive notifications when customers join your waitlist.</p>
        </div>
      `,
      text: `Test email received!\n\nYour email integration is working correctly.\n\nFrom: ${name} via Pinzo <${getRawFromEmail()}>\nReply-To: ${options?.replyTo || "Not set"}\n\nYou will receive notifications when customers join your waitlist.`,
      ...buildReplyTo(options),
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send test email:", error);
    return false;
  }
}

/**
 * GDPR: customers/data_request
 *
 * Shopify sends this when a customer requests a copy of their data.
 * You must respond within 30 days by sending the data to the customer.
 *
 * Required for Shopify App Store listing.
 * https://shopify.dev/docs/apps/build/privacy-law-compliance
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { sendGdprDataRequestExport } from "../email.server";

interface DataRequestPayload {
  customer?: { email?: string };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  const customerEmail = (payload as DataRequestPayload | undefined)?.customer?.email;

  // For this app, the only customer PII stored is waitlist entries (email + zip).
  // Merchant must respond within 30 days — we email the customer directly.
  try {
    if (customerEmail && shop) {
      const rows = await db.waitlistEntry.findMany({
        where: { shop, email: customerEmail },
        select: { zipCode: true, status: true, createdAt: true },
      });

      const delivered = await sendGdprDataRequestExport(customerEmail, shop, rows);
      if (!delivered) {
        // Resend not configured or send failed — log so merchant can respond manually.
        console.error(
          "[GDPR:data_request] email delivery failed shop=%s customer=%s rows=%d",
          shop,
          customerEmail,
          rows.length,
        );
      }
    }
  } catch (err) {
    console.error("[GDPR:data_request] handler error for shop=%s:", shop, err);
    // Shopify requires a 200 response regardless of errors
  }

  return new Response();
};

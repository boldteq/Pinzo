/**
 * GDPR: customers/redact
 *
 * Shopify sends this when a customer requests deletion of their data,
 * or when 10 days have passed after a shop uninstalls the app.
 *
 * You must delete all personally identifiable information for this customer.
 *
 * Required for Shopify App Store listing.
 * https://shopify.dev/docs/apps/build/privacy-law-compliance
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  const customerEmail = payload?.customer?.email;

  try {
    if (customerEmail) {
      // Delete all PII for this customer: waitlist entries contain email addresses
      await db.waitlistEntry.deleteMany({
        where: { shop, email: customerEmail },
      });
    }
  } catch {
    // Shopify requires a 200 response regardless of errors
  }

  return new Response();
};

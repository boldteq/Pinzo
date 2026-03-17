import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // Delete all shop data immediately on uninstall (Shopify App Store requirement).
  // The shop/redact GDPR webhook fires 48 hours later and also runs this cleanup.
  if (shop) {
    try {
      await Promise.all([
        db.session.deleteMany({ where: { shop } }),
        db.zipCode.deleteMany({ where: { shop } }),
        db.deliveryRule.deleteMany({ where: { shop } }),
        db.waitlistEntry.deleteMany({ where: { shop } }),
        db.widgetConfig.deleteMany({ where: { shop } }),
        db.subscription.deleteMany({ where: { shop } }),
        db.shopSettings.deleteMany({ where: { shop } }),
      ]);
    } catch {
      // Log failures silently — Shopify requires a 200 response regardless
    }
  }

  return new Response();
};

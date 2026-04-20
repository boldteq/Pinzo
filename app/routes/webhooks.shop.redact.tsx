/**
 * GDPR: shop/redact
 *
 * Shopify sends this 48 hours after a merchant uninstalls the app.
 * You must delete all data stored for this shop.
 *
 * Required for Shopify App Store listing.
 * https://shopify.dev/docs/apps/build/privacy-law-compliance
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);

  // Delete all shop data in parallel
  try {
    // Delete FeatureVotes first (FK constraint to FeatureRequest)
    await db.featureVote.deleteMany({ where: { shop } });
    await Promise.all([
      db.zipCode.deleteMany({ where: { shop } }),
      db.deliveryRule.deleteMany({ where: { shop } }),
      db.waitlistEntry.deleteMany({ where: { shop } }),
      db.widgetConfig.deleteMany({ where: { shop } }),
      db.subscription.deleteMany({ where: { shop } }),
      db.session.deleteMany({ where: { shop } }),
      db.shopSettings.deleteMany({ where: { shop } }), // contains notificationEmail (PII)
      db.featureRequest.deleteMany({ where: { shop } }),
      db.productCollectionCache.deleteMany({ where: { shop } }),
      db.zipCheckLog.deleteMany({ where: { shop } }),
    ]);
  } catch (err) {
    console.error("[webhook:shop.redact] cleanup failed for shop=%s:", shop, err);
    // Shopify requires a 200 response regardless of errors
  }

  return new Response();
};

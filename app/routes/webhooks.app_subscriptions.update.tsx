import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { syncSubscriptionFromShopify } from "../billing.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  try {
    interface AppSubscriptionPayload {
      app_subscription?: { name?: string; status?: string; admin_graphql_api_id?: string };
    }
    const sub = (payload as AppSubscriptionPayload)?.app_subscription;

    if (!sub || typeof sub.name !== "string" || typeof sub.status !== "string") {
      console.error("[webhook:app_subscriptions] malformed payload", payload);
      return new Response();
    }

    await syncSubscriptionFromShopify(shop, [
      {
        id: sub.admin_graphql_api_id ?? "",
        name: sub.name,
        status: sub.status,
      },
    ]);
  } catch {
    // Subscription sync failed — will be retried on next billing check
  }

  return new Response();
};

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { payload, session } = await authenticate.webhook(request);

    const current = payload.current as string[];
    try {
      if (session) {
        await db.session.update({
          where: {
            id: session.id,
          },
          data: {
            scope: current.toString(),
          },
        });
      }
    } catch {
      // Shopify requires a 200 response regardless of errors
    }
    return new Response();
};

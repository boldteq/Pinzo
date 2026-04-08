/**
 * product-collections.server.ts
 *
 * Resolves which Shopify collections a product belongs to.
 * Used by the ZIP check API to match collection-targeted delivery rules.
 *
 * Caches results in ProductCollectionCache with a 6-hour TTL to avoid
 * hitting the Shopify Admin API on every ZIP check request.
 */

import db from "../db.server";
import { unauthenticated } from "../shopify.server";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Returns the numeric Shopify collection IDs for a given product.
 * Checks DB cache first; falls back to Shopify GraphQL API on cache miss.
 * Returns an empty array on any error (graceful degradation to general rules).
 */
export async function getProductCollections(
  shop: string,
  productId: string,
): Promise<string[]> {
  const sixHoursAgo = new Date(Date.now() - CACHE_TTL_MS);

  // Check cache first
  const cached = await db.productCollectionCache.findMany({
    where: {
      shop,
      productId,
      cachedAt: { gt: sixHoursAgo },
    },
    select: { collectionId: true },
  });

  if (cached.length > 0) {
    return cached.map((c) => c.collectionId);
  }

  // Cache miss — fetch from Shopify API
  try {
    const collectionIds = await fetchProductCollectionsFromShopify(
      shop,
      productId,
    );

    // Upsert cache entries (handles concurrent requests gracefully)
    if (collectionIds.length > 0) {
      await Promise.all(
        collectionIds.map((collectionId) =>
          db.productCollectionCache.upsert({
            where: {
              shop_productId_collectionId: { shop, productId, collectionId },
            },
            create: { shop, productId, collectionId },
            update: { cachedAt: new Date() },
          }),
        ),
      );
    }

    // Clean up stale entries for this product (product may have been removed
    // from collections since last cache — old entries would give false positives)
    await db.productCollectionCache.deleteMany({
      where: {
        shop,
        productId,
        cachedAt: { lt: sixHoursAgo },
      },
    });

    return collectionIds;
  } catch (error) {
    console.error(
      "[product-collections] Failed to fetch collections for product",
      productId,
      "shop",
      shop,
      error,
    );
    // Return empty array — ZIP check falls through to general rules
    return [];
  }
}

interface ShopifyCollectionNode {
  id: string;
}

interface ShopifyProductCollectionsResponse {
  data?: {
    product?: {
      collections?: {
        nodes?: ShopifyCollectionNode[];
      };
    };
  };
}

async function fetchProductCollectionsFromShopify(
  shop: string,
  productId: string,
): Promise<string[]> {
  const { admin } = await unauthenticated.admin(shop);

  const response = await admin.graphql(
    `#graphql
    query ProductCollections($id: ID!) {
      product(id: $id) {
        collections(first: 50) {
          nodes {
            id
          }
        }
      }
    }`,
    {
      variables: {
        id: `gid://shopify/Product/${productId}`,
      },
    },
  );

  const data = (await response.json()) as ShopifyProductCollectionsResponse;
  const nodes = data?.data?.product?.collections?.nodes ?? [];

  // Extract numeric IDs from GIDs: "gid://shopify/Collection/123456" → "123456"
  return nodes
    .map((c) => {
      const match = c.id.match(/\/(\d+)$/);
      return match ? match[1] : null;
    })
    .filter((id): id is string => id !== null);
}

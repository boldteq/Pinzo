/**
 * Shared utility for detecting whether the Pinzo App Embed is active
 * in the merchant's live theme.
 *
 * Used by both app._index.tsx (dashboard) and app.settings.tsx (Setup Guide tab).
 */

interface AdminGraphQL {
  graphql(query: string): Promise<{ json(): Promise<unknown> }>;
}

export interface ThemeDetectionResult {
  appEmbedEnabled: boolean;
  activeThemeName: string | null;
  themeEditorUrl: string;
  themeEditorAppEmbedsUrl: string;
}

export async function detectThemeEmbed(
  shop: string,
  admin: AdminGraphQL,
): Promise<ThemeDetectionResult> {
  let appEmbedEnabled = false;
  let activeThemeName: string | null = null;
  let themeEditorUrl = `https://${shop}/admin/themes/current/editor`;
  let themeEditorAppEmbedsUrl = `https://${shop}/admin/themes/current/editor?context=apps`;

  try {
    const themeResponse = await admin.graphql(`{
      themes(first: 1, roles: MAIN) {
        nodes {
          id
          name
          files(filenames: ["config/settings_data.json"], first: 1) {
            nodes {
              body {
                ... on OnlineStoreThemeFileBodyText {
                  content
                }
              }
            }
          }
        }
      }
    }`);
    const themeData = (await themeResponse.json()) as {
      data?: {
        themes?: {
          nodes?: Array<{
            id: string;
            name: string;
            files?: {
              nodes?: Array<{
                body?: { content?: string };
              }>;
            };
          }>;
        };
      };
    };
    const mainTheme = themeData?.data?.themes?.nodes?.[0];
    if (mainTheme) {
      const gidParts = mainTheme.id.split("/");
      const numericId = gidParts[gidParts.length - 1];
      activeThemeName = mainTheme.name;
      themeEditorUrl = `https://${shop}/admin/themes/${numericId}/editor`;
      themeEditorAppEmbedsUrl = `https://${shop}/admin/themes/${numericId}/editor?context=apps`;

      let content = mainTheme.files?.nodes?.[0]?.body?.content;
      if (content) {
        content = content.replace(/^\/\*[\s\S]*?\*\/\s*/, "").trim();
        const jsonStart = content.indexOf("{");
        if (jsonStart > 0) content = content.substring(jsonStart);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let settingsData: any;
        try {
          settingsData = JSON.parse(content);
        } catch {
          return { appEmbedEnabled, activeThemeName, themeEditorUrl, themeEditorAppEmbedsUrl };
        }
        const apiKey = process.env.SHOPIFY_API_KEY ?? "";

        const blocks = settingsData?.current?.blocks ?? {};
        const embedBlocks = Object.entries(blocks).filter(([, block]) => {
          const b = block as { type?: string };
          const t = b.type ?? "";
          return t.includes("app_embed") || t.includes("app-embed");
        });

        for (const [key, block] of embedBlocks) {
          const b = block as { type?: string; disabled?: boolean };
          if (b.disabled === true) continue;
          const typeStr = b.type ?? "";
          const keyStr = key;
          if (
            (apiKey && (keyStr.includes(apiKey) || typeStr.includes(apiKey))) ||
            keyStr.includes("zip-code") || typeStr.includes("zip-code") ||
            keyStr.includes("zip_code") || typeStr.includes("zip_code") ||
            keyStr.includes("pinzo") || typeStr.includes("pinzo")
          ) {
            appEmbedEnabled = true;
            break;
          }
        }

        if (!appEmbedEnabled) {
          const contentLower = content.toLowerCase();
          const hasEmbed = contentLower.includes("app_embed");
          const hasOurApp =
            (apiKey && contentLower.includes(apiKey.toLowerCase())) ||
            contentLower.includes("zip-code-checker") ||
            contentLower.includes("zip-code-widget") ||
            contentLower.includes("pinzo");
          if (hasEmbed && hasOurApp) {
            const notDisabled = !contentLower.includes('"disabled":true');
            if (notDisabled) appEmbedEnabled = true;
          }
        }
      }
    }
  } catch {
    // Detection failed — leave defaults
  }

  return { appEmbedEnabled, activeThemeName, themeEditorUrl, themeEditorAppEmbedsUrl };
}

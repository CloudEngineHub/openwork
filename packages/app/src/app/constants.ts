import type { ModelRef, SuggestedPlugin } from "./types";

export const MODEL_PREF_KEY = "openwork.defaultModel";
export const SESSION_MODEL_PREF_KEY = "openwork.sessionModels";
export const THINKING_PREF_KEY = "openwork.showThinking";
export const VARIANT_PREF_KEY = "openwork.modelVariant";
export const LANGUAGE_PREF_KEY = "openwork.language";
export const HIDE_TITLEBAR_PREF_KEY = "openwork.hideTitlebar";

export const DEFAULT_MODEL: ModelRef = {
  providerID: "opencode",
  modelID: "big-pickle",
};

export const SUGGESTED_PLUGINS: SuggestedPlugin[] = [
  {
    name: "OpenCode Browser Automation",
    packageName: "@different-ai/opencode-browser",
    description:
      "Control real browser tabs from OpenWork. Includes a guided setup flow for unpacked extension installs while the store listing is pending.",
    tags: ["browser", "automation", "guided"],
    aliases: ["opencode-browser"],
    installMode: "guided",
    steps: [
      {
        title: "Add plugin",
        description:
          "Click Add on this card to include @different-ai/opencode-browser in your OpenCode plugin config.",
      },
      {
        title: "Run installer",
        description:
          "In your workspace terminal, run the installer. This path does not require Chrome Web Store approval.",
        command: "bunx @different-ai/opencode-browser@latest install",
      },
      {
        title: "Load unpacked extension",
        description:
          "Open chrome://extensions, enable Developer mode, click Load unpacked, then select the extension folder.",
        path: "~/.opencode-browser/extension",
        note: "The installer writes the native host manifest and prompts for the extension ID when needed.",
      },
      {
        title: "Verify in OpenWork",
        description: "Start a session and run a quick check command to confirm browser automation is connected.",
        command: "use browser_status",
      },
      {
        title: "Keep it updated",
        description: "After updates, refresh the local files and reload the extension from chrome://extensions.",
        command: "bunx @different-ai/opencode-browser@latest update",
      },
    ],
  },
  {
    name: "opencode-scheduler",
    packageName: "opencode-scheduler",
    description: "Run scheduled jobs with the OpenCode scheduler plugin.",
    tags: ["automation", "jobs"],
    installMode: "simple",
  },
];

export type McpDirectoryInfo = {
  name: string;
  description: string;
  url?: string;
  type?: "remote" | "local";
  command?: string[];
  oauth: boolean;
};

export const MCP_QUICK_CONNECT: McpDirectoryInfo[] = [
  {
    name: "Notion",
    description: "Pages, databases, and project docs in sync.",
    url: "https://mcp.notion.com/mcp",
    type: "remote",
    oauth: true,
  },
  {
    name: "Linear",
    description: "Plan sprints and ship tickets faster.",
    url: "https://mcp.linear.app/mcp",
    type: "remote",
    oauth: true,
  },
  {
    name: "Sentry",
    description: "Track releases and resolve production errors.",
    url: "https://mcp.sentry.dev/mcp",
    type: "remote",
    oauth: true,
  },
  {
    name: "Stripe",
    description: "Inspect payments, invoices, and subscriptions.",
    url: "https://mcp.stripe.com",
    type: "remote",
    oauth: true,
  },
  {
    name: "HubSpot",
    description: "CRM notes, companies, and pipeline status.",
    url: "https://mcp.hubspot.com/anthropic",
    type: "remote",
    oauth: true,
  },
  {
    name: "Context7",
    description: "Search product docs with richer context.",
    url: "https://mcp.context7.com/mcp",
    type: "remote",
    oauth: false,
  },
  {
    name: "Chrome DevTools",
    description: "Drive Chrome tabs with browser automation.",
    type: "local",
    command: ["npx", "-y", "chrome-devtools-mcp@latest"],
    oauth: false,
  },
];

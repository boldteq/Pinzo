/**
 * Claude Hub Agent Client
 *
 * Calls global agents from Claude Hub (localhost:3847) during development.
 * Drop this file into any Boldteq app's utils/ folder to use agents.
 *
 * Usage:
 *   import { callAgent, listAgents, getAgent } from "~/utils/agent.server";
 *
 *   // Call an agent with a task
 *   const result = await callAgent("quill", "Write an app store listing for Pinzo");
 *
 *   // List all available agents
 *   const agents = await listAgents();
 *
 *   // Get a specific agent's details
 *   const quill = await getAgent("quill");
 */

const CLAUDE_HUB_URL = process.env.CLAUDE_HUB_URL || "http://localhost:3847";

export interface Agent {
  filename: string;
  name: string;
  description: string;
  model: string;
  body: string;
  raw: string;
  updatedAt: string;
}

export interface AgentResult {
  success: boolean;
  output: string;
  agent: string;
  error?: string;
}

/**
 * Call a global agent with a prompt.
 * Uses Claude Hub's playground endpoint which runs `claude -p` locally.
 *
 * @param agentName - filename of the agent (e.g. "quill", "vex", "sage")
 * @param prompt - the task/prompt to send to the agent
 * @param timeoutMs - timeout in ms (default 120s, some agents take a while)
 * @returns AgentResult with the agent's output
 *
 * @example
 * const result = await callAgent("quill", "Write a changelog entry for: Added bulk ZIP import");
 * console.log(result.output);
 */
export async function callAgent(
  agentName: string,
  prompt: string,
  timeoutMs = 120000
): Promise<AgentResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${CLAUDE_HUB_URL}/api/playground/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentName, prompt }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Claude Hub returned ${response.status}`);
    }

    // Parse SSE stream
    const text = await response.text();
    const events = text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => {
        try {
          return JSON.parse(line.slice(6));
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    // Find the final output
    const doneEvent = events.find((e) => e.type === "done" || e.type === "complete");
    const errorEvent = events.find((e) => e.type === "error");

    if (errorEvent) {
      return {
        success: false,
        output: "",
        agent: agentName,
        error: errorEvent.error,
      };
    }

    return {
      success: true,
      output: doneEvent?.output || "",
      agent: agentName,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      output: "",
      agent: agentName,
      error: message.includes("abort")
        ? `Agent timed out after ${timeoutMs / 1000}s`
        : `Claude Hub connection failed: ${message}. Is Claude Hub running on ${CLAUDE_HUB_URL}?`,
    };
  }
}

/**
 * List all available global agents from Claude Hub.
 *
 * @example
 * const agents = await listAgents();
 * agents.forEach(a => console.log(`${a.filename}: ${a.description}`));
 */
export async function listAgents(): Promise<Agent[]> {
  try {
    const response = await fetch(`${CLAUDE_HUB_URL}/api/global/agents`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error("[agent-client] Failed to list agents:", error);
    return [];
  }
}

/**
 * Get a specific agent's full details (instructions, model, description).
 *
 * @param agentName - filename of the agent (e.g. "quill")
 * @example
 * const quill = await getAgent("quill");
 * console.log(quill?.body); // Full agent instructions
 */
export async function getAgent(agentName: string): Promise<Agent | null> {
  try {
    const response = await fetch(`${CLAUDE_HUB_URL}/api/global/agents/${agentName}`);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error(`[agent-client] Failed to get agent ${agentName}:`, error);
    return null;
  }
}

/**
 * List all agents across all projects (global + project-scoped).
 *
 * @example
 * const all = await listAllAgents();
 * all.forEach(a => console.log(`[${a.scope}] ${a.name}`));
 */
export async function listAllAgents(): Promise<(Agent & { scope: string; projectName?: string })[]> {
  try {
    const response = await fetch(`${CLAUDE_HUB_URL}/api/unified/agents`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error("[agent-client] Failed to list all agents:", error);
    return [];
  }
}

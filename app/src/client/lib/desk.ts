import { useAgent } from "agents/react";
import { useMemo, useRef, useState } from "react";
import type { AppKey, PiSettings } from "../../shared/apps";
import { userInstance } from "./auth";

export type DeskState = {
  settings: PiSettings | null;
  appErrors: Partial<Record<AppKey, string>>;
  authUrls?: Partial<Record<AppKey, string>>;
  gcalReady?: boolean;
};

export type McpServersSnapshot = {
  servers: Record<
    string,
    { name: string; server_url: string; state: string; error: string | null }
  >;
};

/**
 * A per-user "desk" agent instance shared by the planner, agenda, and apps
 * pages: one place that holds MCP connections outside any single chat.
 */
export function useDesk(settings: PiSettings) {
  const [deskState, setDeskState] = useState<DeskState | null>(null);
  const [mcp, setMcp] = useState<McpServersSnapshot | null>(null);

  const agent = useAgent({
    agent: "pi",
    name: userInstance(settings.netid, "desk"),
    onStateUpdate: (state: DeskState) => setDeskState(state),
    onMcpUpdate: (snapshot) => setMcp(snapshot as McpServersSnapshot),
  });

  const settingsHash = useMemo(() => JSON.stringify(settings), [settings]);
  const appliedRef = useRef<string | null>(null);

  async function ensureSetup(): Promise<void> {
    if (appliedRef.current === settingsHash) return;
    await agent.ready;
    await agent.call("setup", [settings]);
    appliedRef.current = settingsHash;
  }

  async function callApp(
    app: AppKey,
    tool: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    await ensureSetup();
    return agent.call("callAppTool", [app, tool, args]);
  }

  return { agent, deskState, mcp, ensureSetup, callApp, settingsHash };
}

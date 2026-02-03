import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Check, ChevronDown, Loader2, Plus } from "lucide-solid";

import type { TodoItem } from "../../types";
import type { WorkspaceInfo } from "../../lib/tauri";

type SessionSummary = {
  id: string;
  title: string;
  slug?: string | null;
};

type WorkspaceSessionGroup = {
  workspace: WorkspaceInfo;
  sessions: SessionSummary[];
};

export type SidebarSectionState = {
  progress: boolean;
  artifacts: boolean;
  context: boolean;
  plugins: boolean;
  mcp: boolean;
  skills: boolean;
  authorizedFolders: boolean;
};

export type SidebarProps = {
  todos: TodoItem[];
  expandedSections: SidebarSectionState;
  onToggleSection: (section: keyof SidebarSectionState) => void;
  workspaceGroups: WorkspaceSessionGroup[];
  activeWorkspaceId: string;
  connectingWorkspaceId?: string | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onAddWorkspace: () => void;
  onSelectSession: (workspaceId: string, sessionId: string) => void;
  selectedSessionId: string | null;
  sessionStatusById: Record<string, string>;
  onCreateSession: () => void;
  onDeleteSession: (id: string) => void;
  newTaskDisabled: boolean;
};

export default function SessionSidebar(props: SidebarProps) {
  const realTodos = createMemo(() => props.todos.filter((todo) => todo.content.trim()));

  const workspaceLabel = (workspace: WorkspaceInfo) =>
    workspace.displayName?.trim() ||
    workspace.openworkWorkspaceName?.trim() ||
    workspace.name?.trim() ||
    workspace.path?.trim() ||
    "Workspace";

  const workspacePathLabel = (workspace: WorkspaceInfo) => {
    if (workspace.workspaceType === "remote") {
      if (workspace.remoteType === "openwork") {
        return (
          workspace.openworkHostUrl?.trim() ||
          workspace.baseUrl?.trim() ||
          workspace.path?.trim() ||
          ""
        );
      }
      return workspace.baseUrl?.trim() || workspace.path?.trim() || "";
    }
    return workspace.path?.trim() || "";
  };

  const workspaceDetailLabel = (workspace: WorkspaceInfo) => {
    if (workspace.workspaceType !== "remote") return "";
    return workspace.openworkWorkspaceName?.trim() || workspace.directory?.trim() || "";
  };

  const progressDots = createMemo(() => {
    const activeTodos = realTodos();
    const total = activeTodos.length;
    if (!total) return [] as boolean[];
    const completed = activeTodos.filter((todo) => todo.status === "completed").length;
    return Array.from({ length: total }, (_, idx) => idx < completed);
  });

  const [contextMenu, setContextMenu] = createSignal<null | {
    sessionId: string;
    x: number;
    y: number;
  }>(null);

  const closeContextMenu = () => setContextMenu(null);

  const openContextMenu = (event: MouseEvent, sessionId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ sessionId, x: event.clientX, y: event.clientY });
  };

  const contextMenuStyle = createMemo(() => {
    const menu = contextMenu();
    if (!menu) return undefined;
    const width = 188;
    const height = 96;
    if (typeof window === "undefined") {
      return { left: `${menu.x}px`, top: `${menu.y}px` };
    }
    const maxX = Math.max(12, window.innerWidth - width - 12);
    const maxY = Math.max(12, window.innerHeight - height - 12);
    return {
      left: `${Math.min(menu.x, maxX)}px`,
      top: `${Math.min(menu.y, maxY)}px`,
    };
  });

  createEffect(() => {
    if (!contextMenu()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <div class="px-4 pt-4 shrink-0">
        <button
          class="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-gray-12 text-gray-1 text-sm font-medium shadow-lg shadow-gray-12/10 hover:bg-gray-11 transition-colors"
          onClick={props.onCreateSession}
          disabled={props.newTaskDisabled}
        >
          <Plus size={16} />
          New task
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        <div>
          <div class="flex items-center justify-between px-2 mb-2">
            <div class="text-xs text-gray-10 font-semibold uppercase tracking-wider">Workspaces</div>
          </div>
          <div class="space-y-4">
            <Show
              when={props.workspaceGroups.length > 0}
              fallback={
                <div class="px-3 py-2 rounded-lg border border-dashed border-gray-6 text-xs text-gray-9">
                  No workspaces in this session yet. Add one to get started.
                </div>
              }
            >
              <For each={props.workspaceGroups}>
                {(group) => {
                  const isActive = () => props.activeWorkspaceId === group.workspace.id;
                  const isConnecting = () => props.connectingWorkspaceId === group.workspace.id;
                  const pathLabel = () => workspacePathLabel(group.workspace);
                  const detailLabel = () => workspaceDetailLabel(group.workspace);
                  const sessions = () => group.sessions;
                  const allowActions = () => !props.connectingWorkspaceId || isConnecting();

                  return (
                    <div class="space-y-2">
                      <button
                        type="button"
                        class={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                          isActive()
                            ? "border-indigo-7/40 bg-indigo-2/30 text-gray-12"
                            : "border-gray-6/40 text-gray-11 hover:text-gray-12 hover:bg-gray-2"
                        } ${isConnecting() ? "opacity-70" : ""}`.trim()}
                        onClick={() => {
                          if (isActive() || isConnecting()) return;
                          if (!allowActions()) return;
                          props.onSelectWorkspace(group.workspace.id);
                        }}
                        disabled={isActive() || isConnecting() || !allowActions()}
                      >
                        <div class="flex items-start justify-between gap-2">
                          <div class="min-w-0 space-y-0.5">
                            <div class="flex items-center gap-2">
                              <span class="text-xs font-semibold truncate">
                                {workspaceLabel(group.workspace)}
                              </span>
                              <Show when={group.workspace.workspaceType === "remote"}>
                                <span class="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-gray-3 text-gray-11">
                                  Remote
                                </span>
                              </Show>
                            </div>
                            <Show when={pathLabel()}>
                              <div class="text-[10px] text-gray-9 font-mono truncate">{pathLabel()}</div>
                            </Show>
                            <Show when={detailLabel() && detailLabel() !== pathLabel()}>
                              <div class="text-[10px] text-gray-8 truncate">{detailLabel()}</div>
                            </Show>
                          </div>
                          <div class="flex items-center gap-2 text-[10px] shrink-0">
                            <Show when={isConnecting()}>
                              <Loader2 size={12} class="text-gray-10 animate-spin" />
                            </Show>
                            <Show when={!isConnecting()}>
                              <Show when={isActive()} fallback={<span class="text-gray-9">Switch</span>}>
                                <span class="text-green-11 font-medium">Active</span>
                              </Show>
                            </Show>
                          </div>
                        </div>
                      </button>
                      <div class="space-y-1 pl-2">
                        <Show
                          when={sessions().length > 0}
                          fallback={
                            <div class="px-3 py-2 rounded-lg border border-dashed border-gray-6 text-xs text-gray-9">
                              No sessions yet.
                            </div>
                          }
                        >
                          <For each={sessions().slice(0, 8)}>
                            {(session) => (
                              <button
                                class={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                                  session.id === props.selectedSessionId
                                    ? "bg-gray-3 text-gray-12 font-medium"
                                    : "text-gray-11 hover:text-gray-12 hover:bg-gray-2"
                                } ${!allowActions() ? "opacity-70" : ""}`}
                                onClick={() => {
                                  if (!allowActions()) return;
                                  props.onSelectSession(group.workspace.id, session.id);
                                }}
                                onContextMenu={(event) => {
                                  if (!isActive()) return;
                                  openContextMenu(event, session.id);
                                }}
                                disabled={!allowActions()}
                              >
                                <div class="flex items-center justify-between gap-2 w-full overflow-hidden">
                                  <div class="truncate">{session.title}</div>
                                  <Show
                                    when={
                                      props.sessionStatusById[session.id] &&
                                      props.sessionStatusById[session.id] !== "idle"
                                    }
                                  >
                                    <span
                                      class={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border flex items-center gap-1 ${
                                        props.sessionStatusById[session.id] === "running"
                                          ? "border-amber-7/50 text-amber-11 bg-amber-2/50"
                                          : "border-gray-7/50 text-gray-10 bg-gray-2/50"
                                      }`}
                                    >
                                      <div
                                        class={`w-1 h-1 rounded-full ${
                                          props.sessionStatusById[session.id] === "running"
                                            ? "bg-amber-9 animate-pulse"
                                            : "bg-gray-9"
                                        }`}
                                      />
                                    </span>
                                  </Show>
                                </div>
                              </button>
                            )}
                          </For>
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </Show>
            <button
              type="button"
              class="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-gray-11 border border-dashed border-gray-6 hover:border-gray-7 hover:text-gray-12 hover:bg-gray-2 transition-colors"
              onClick={props.onAddWorkspace}
            >
              <Plus size={14} />
              Add new workspace
            </button>
          </div>
        </div>

        <div class="space-y-4">
          <Show when={realTodos().length > 0}>
            <div class="rounded-2xl border border-gray-6 bg-gray-2/30" id="sidebar-progress">
              <button
                class="w-full px-4 py-3 flex items-center justify-between text-sm text-gray-12 font-medium"
                onClick={() => props.onToggleSection("progress")}
              >
                <span>Progress</span>
                <ChevronDown
                  size={16}
                  class={`transition-transform text-gray-10 ${
                    props.expandedSections.progress ? "rotate-180" : ""
                  }`.trim()}
                />
              </button>
              <Show when={props.expandedSections.progress}>
                <div class="px-4 pb-4 pt-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <For each={progressDots()}>
                      {(done) => (
                        <div
                          class={`h-6 w-6 rounded-full border flex items-center justify-center transition-colors ${
                            done
                              ? "border-green-6 bg-green-2 text-green-11"
                              : "border-gray-6 bg-gray-1 text-gray-8"
                          }`}
                        >
                          <Show when={done}>
                            <Check size={14} />
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      <Show when={contextMenu()}>
        {(menu) => (
          <div
            class="fixed inset-0 z-50"
            onClick={closeContextMenu}
            onContextMenu={(event) => {
              event.preventDefault();
              closeContextMenu();
            }}
          >
            <div
              class="fixed w-44 rounded-xl border border-gray-6 bg-gray-1 shadow-2xl shadow-gray-12/10 p-1"
              style={contextMenuStyle()}
              role="menu"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                class="w-full text-left px-3 py-2 text-sm rounded-lg text-gray-12 hover:bg-gray-2 transition-colors"
                role="menuitem"
                onClick={() => {
                  props.onCreateSession();
                  closeContextMenu();
                }}
              >
                New task
              </button>
              <button
                class="w-full text-left px-3 py-2 text-sm rounded-lg text-red-11 hover:bg-red-1/40 transition-colors"
                role="menuitem"
                onClick={() => {
                  props.onDeleteSession(menu().sessionId);
                  closeContextMenu();
                }}
              >
                Delete session
              </button>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

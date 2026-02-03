import { createEffect, createMemo, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import type { TargetProfile } from "../types";
import { normalizeOpenworkServerUrl } from "../lib/openwork-server";

export type TargetStore = ReturnType<typeof createTargetStore>;

type TargetState = {
  items: TargetProfile[];
  defaultId?: string | null;
  lastActiveId?: string | null;
};

const STORAGE_KEY = "openwork.executionTargets.v1";
const LOCAL_TARGET_ID = "tgt-local";

const readState = (): TargetState => {
  if (typeof window === "undefined") return { items: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { items: [] };
    const parsed = JSON.parse(raw) as TargetState;
    if (!parsed || !Array.isArray(parsed.items)) return { items: [] };
    return parsed;
  } catch {
    return { items: [] };
  }
};

const writeState = (state: TargetState) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
};

const generateId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `tgt-${crypto.randomUUID()}`;
  }
  return `tgt-${Math.random().toString(36).slice(2, 10)}`;
};

export function createTargetStore() {
  const [state, setState] = createStore<TargetState>(readState());
  const [activeTargetId, setActiveTargetId] = createSignal(
    state.lastActiveId ?? state.defaultId ?? LOCAL_TARGET_ID,
  );

  createEffect(() => {
    writeState({ ...state, lastActiveId: activeTargetId() });
  });

  const targets = createMemo(() => state.items);

  const addTarget = (input: { label: string; baseUrl: string; token?: string | null }) => {
    const normalized = normalizeOpenworkServerUrl(input.baseUrl) ?? "";
    if (!normalized) return null;
    const next: TargetProfile = {
      id: generateId(),
      label: input.label.trim() || normalized,
      type: "remote",
      baseUrl: normalized,
      token: input.token?.trim() || null,
      lastUsedAt: Date.now(),
      status: "unknown",
    };
    setState("items", (items) => [...items, next]);
    return next;
  };

  const updateTarget = (id: string, input: Partial<Omit<TargetProfile, "id" | "type">>) => {
    setState(
      "items",
      (items) =>
        items.map((target) =>
          target.id === id
            ? {
                ...target,
                label: input.label?.trim() ?? target.label,
                baseUrl: input.baseUrl ? normalizeOpenworkServerUrl(input.baseUrl) ?? target.baseUrl : target.baseUrl,
                token: input.token !== undefined ? input.token : target.token,
                lastUsedAt: input.lastUsedAt ?? target.lastUsedAt,
                status: input.status ?? target.status,
              }
            : target,
        ),
    );
  };

  const removeTarget = (id: string) => {
    setState("items", (items) => items.filter((target) => target.id !== id));
    if (state.defaultId === id) {
      setState("defaultId", null);
    }
    if (activeTargetId() === id) {
      setActiveTargetId(LOCAL_TARGET_ID);
    }
  };

  const setDefaultTarget = (id: string | null) => {
    setState("defaultId", id);
  };

  const setActiveTarget = (id: string) => {
    setActiveTargetId(id);
  };

  return {
    targets,
    activeTargetId,
    setActiveTarget,
    addTarget,
    updateTarget,
    removeTarget,
    defaultTargetId: () => state.defaultId ?? null,
    setDefaultTarget,
    storageKey: STORAGE_KEY,
  };
}

export const LocalTarget = {
  id: LOCAL_TARGET_ID,
  label: "Local (this device)",
  type: "local" as const,
};

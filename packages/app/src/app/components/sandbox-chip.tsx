import type { OpenworkSandboxInfo, OpenworkTargetInfo } from "../lib/openwork-server";

import { Box, ChevronDown, Globe, HardDrive, Loader2 } from "lucide-solid";

const targetLabelFallback = (target: OpenworkTargetInfo | null) => {
  if (!target) return "Target";
  return target.type === "remote" ? "Remote" : "Local";
};

export default function SandboxChip(props: {
  sandbox: OpenworkSandboxInfo | null;
  target: OpenworkTargetInfo | null;
  onClick: () => void;
  connecting?: boolean;
}) {
  const TargetIcon = props.target?.type === "remote" ? Globe : HardDrive;
  const status = () => props.sandbox?.status ?? "active";
  const targetLabel = () => props.target?.label?.trim() || targetLabelFallback(props.target);

  return (
    <button
      onClick={props.onClick}
      class="flex items-center gap-2 pl-3 pr-2 py-1.5 bg-gray-2 border border-gray-6 rounded-lg hover:border-gray-7 hover:bg-gray-4 transition-all group"
    >
      <div class="p-1 rounded bg-amber-7/10 text-amber-6">
        <Box size={14} />
      </div>
      <div class="flex flex-col items-start mr-2 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-gray-12 leading-none truncate max-w-[9.5rem]">
            {props.sandbox?.name ?? "Sandbox"}
          </span>
          <span class="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-gray-4 text-gray-11">
            {status()}
          </span>
        </div>
        <div class="flex items-center gap-1 text-[10px] text-gray-10 font-mono leading-none max-w-[140px] truncate">
          <TargetIcon size={11} class="text-gray-8" />
          <span class="truncate">{targetLabel()}</span>
        </div>
      </div>
      <ChevronDown size={14} class="text-gray-10 group-hover:text-gray-11" />
      {props.connecting ? <Loader2 size={14} class="text-gray-10 animate-spin" /> : null}
    </button>
  );
}

"use client";

import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

function StatusDot({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`block size-2 rounded-full ${
          active ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" : "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]"
        }`}
      />
      <span className="text-xs text-zinc-400">{label}</span>
    </div>
  );
}

export function TopBar() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/5 px-4">
      <div className="flex items-center gap-3">
        <span className="bg-gradient-to-br from-violet-400 to-violet-600 bg-clip-text text-lg font-bold tracking-tight text-transparent">
          VZ
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-zinc-400 hover:text-zinc-200"
          aria-label="Open session history"
        >
          <Menu className="size-4" />
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <StatusDot label="Server" active />
        <StatusDot label="Obsidian API" active />
      </div>
    </header>
  );
}

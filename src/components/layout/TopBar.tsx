"use client";

import { useState, useRef, useEffect } from "react";
import { Menu, LogOut } from "lucide-react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { NotificationBell } from "@/components/layout/NotificationBell";

interface UserInfo {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

function UserMenu({ user }: { user: UserInfo }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        className="overflow-hidden rounded-full ring-2 ring-transparent transition-all hover:ring-violet-500/50"
        onClick={() => setOpen((p) => !p)}
        aria-label="Меню пользователя"
      >
        {user.image ? (
          <Image
            src={user.image}
            alt={user.name ?? "Пользователь"}
            width={32}
            height={32}
            className="size-8 rounded-full"
          />
        ) : (
          <div className="size-8 rounded-full bg-gradient-to-br from-violet-500 to-violet-700" />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
          >
            <div className="border-b border-zinc-800 px-4 py-3">
              <p className="truncate text-sm font-medium text-zinc-200">
                {user.name ?? "Пользователь"}
              </p>
              <p className="truncate text-xs text-zinc-500">
                {user.email}
              </p>
            </div>
            <form action="/api/auth/signout" method="POST">
              <button
                type="submit"
                className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                <LogOut className="size-4" />
                Выйти
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function TopBar({ user }: { user?: UserInfo | null }) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between">
        {/* Branding */}
        <div className="flex items-center">
          <span className="text-lg font-normal tracking-tight text-zinc-100">
            Voice
          </span>
          <span className="bg-gradient-to-br from-violet-400 to-violet-600 bg-clip-text text-lg font-light tracking-tight text-transparent">
            Zettel
          </span>
        </div>

        {/* Right side: avatar + bell + burger */}
        <div className="flex items-center gap-2">
          {/* User avatar with menu */}
          {user ? (
            <UserMenu user={user} />
          ) : (
            <div className="size-8 rounded-full bg-gradient-to-br from-violet-500 to-violet-700" />
          )}

          {/* Notifications bell */}
          <NotificationBell />

          {/* Burger → opens settings */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-zinc-400 hover:text-zinc-200"
            aria-label="Открыть настройки"
            onClick={() => setSettingsOpen(true)}
          >
            <Menu className="size-5" />
          </Button>
        </div>
      </header>

      {/* Settings overlay */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
}

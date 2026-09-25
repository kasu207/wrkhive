"use client";

import { CalendarDays, Dumbbell, LayoutDashboard, List, LogOut, MessageSquare, Plus, Settings, Watch } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { logout } from "@/app/actions/auth";
import { Logo, LogoMark } from "@/components/brand";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/dashboard", label: "Übersicht", icon: LayoutDashboard },
  { href: "/workouts", label: "Workouts", icon: Dumbbell },
  { href: "/calendar", label: "Kalender", icon: CalendarDays },
  { href: "/coach", label: "Coach", icon: MessageSquare },
  { href: "/activities", label: "Aktivitäten", icon: List },
  { href: "/devices", label: "Geräte", icon: Watch },
];

const MOBILE_NAV = NAV.filter((n) => n.href !== "/activities");

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ user, demo, children }: { user: { name: string; email: string }; demo: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-dvh lg:pl-[248px]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-16 items-center px-5">
          <Link href="/dashboard" aria-label="Wrkhive Startseite">
            <Logo />
          </Link>
        </div>
        <div className="px-3 pb-3">
          <Link href="/workouts/new" className={buttonClass("primary", "md", "w-full")}>
            <Plus />
            Neues Workout
          </Link>
        </div>
        <nav className="flex-1 space-y-0.5 px-3" aria-label="Hauptnavigation">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex h-10 items-center gap-3 rounded-[10px] px-3 text-[14px] font-medium transition-colors",
                  active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2/70 hover:text-ink",
                )}
              >
                <Icon className={cn("size-[18px]", active ? "text-ink" : "text-ink-3 group-hover:text-ink-2")} />
                {label}
              </Link>
            );
          })}
        </nav>
        {demo ? (
          <div className="mx-3 mb-3 rounded-xl border border-[#f5dd9c] bg-brand-soft p-3 text-[12px] leading-relaxed text-brand-ink">
            <strong className="font-semibold">Demo-Konto.</strong> Alle Aktivitäten sind Beispieldaten. Erstelle ein eigenes Konto, um deine Geräte zu verbinden.
          </div>
        ) : null}
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2">
            <Link href="/settings" className={cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-2 py-2 transition-colors hover:bg-surface-2", isActive(pathname, "/settings") && "bg-surface-2")}>
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-semibold text-white">{initials || "?"}</span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-ink">{user.name}</span>
                <span className="block truncate text-[12px] text-ink-3">Profil & Schwellen</span>
              </span>
            </Link>
            <form action={logout}>
              <button type="submit" className={buttonClass("ghost", "icon-sm")} aria-label="Abmelden" title="Abmelden">
                <LogOut />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface/90 px-4 backdrop-blur-md lg:hidden">
        <Link href="/dashboard" aria-label="Wrkhive Startseite" className="flex items-center gap-2">
          <LogoMark className="size-7" />
          <span className="text-[16px] font-semibold tracking-[-0.03em]">wrkhive</span>
        </Link>
        <div className="flex items-center gap-1">
          <Link href="/workouts/new" className={buttonClass("primary", "sm")} aria-label="Neues Workout">
            <Plus />
            Neu
          </Link>
          <Link href="/settings" className={buttonClass("ghost", "icon")} aria-label="Einstellungen">
            <Settings />
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1200px] px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10">{children}</main>

      {/* Mobile tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
        aria-label="Hauptnavigation"
      >
        {MOBILE_NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium", active ? "text-ink" : "text-ink-3")}>
              <Icon className="size-[21px]" strokeWidth={active ? 2.2 : 1.8} />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

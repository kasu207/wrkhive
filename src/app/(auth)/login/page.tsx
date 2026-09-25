import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DemoButton, LoginForm } from "@/components/auth-forms";
import { getCurrentUser } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Anmelden" };

export default async function LoginPage(props: PageProps<"/login">) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { next } = await props.searchParams;
  return (
    <div>
      <h1 className="text-[28px] font-semibold tracking-[-0.025em]">Willkommen zurück</h1>
      <p className="mb-7 mt-1.5 text-[15px] text-ink-2">Melde dich an, um deine Workouts zu bearbeiten.</p>
      <LoginForm next={typeof next === "string" ? next : undefined} />
      <div className="my-6 flex items-center gap-3 text-[12px] text-ink-3">
        <span className="h-px flex-1 bg-border" />
        oder
        <span className="h-px flex-1 bg-border" />
      </div>
      <DemoButton className="w-full">Ohne Konto ausprobieren</DemoButton>
      <p className="mt-8 text-center text-sm text-ink-2">
        Noch kein Konto?{" "}
        <Link href="/signup" className="font-semibold text-ink underline-offset-4 hover:underline">
          Registrieren
        </Link>
      </p>
    </div>
  );
}

import Link from "next/link";
import { Logo } from "@/components/brand";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center px-5 sm:px-8">
        <Link href="/" aria-label="Wrkhive Startseite">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-[400px] animate-fade-up">{children}</div>
      </main>
    </div>
  );
}

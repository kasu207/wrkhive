import type { Metadata, Viewport } from "next";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Wrkhive – Workouts bauen, aufs Gerät senden", template: "%s · Wrkhive" },
  description:
    "Strukturierte Workouts für Rad, Laufen und Kraft in Sekunden erstellen und direkt an Garmin und Wahoo senden. Mit KI-Coach, Trainingsplänen und Analyse.",
  applicationName: "Wrkhive",
};

export const viewport: Viewport = {
  themeColor: "#f7f7f5",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de" className="h-full">
      <body className="min-h-full">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}

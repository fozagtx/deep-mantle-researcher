import "./globals.css";
import type { Metadata } from "next";
import { fontDisplay, fontBody, fontMono } from "@/lib/fonts";
import { WalletProvider } from "@/lib/wallet";
import { Toaster } from "sonner";
import NextTopLoader from "nextjs-toploader";
import { WagmiProviders } from "@/lib/wagmi-providers";
import { messages } from "@/lib/copy";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SkipToContentLink from "@/components/SkipToContentLink";
import ScrollToTopOnLoad from "@/components/ScrollToTopOnLoad";

export const metadata: Metadata = {
  title: messages.metadata.title,
  description: messages.metadata.description,
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icons/branium-logo.svg",
  },
  openGraph: {
    title: messages.metadata.title,
    description: messages.metadata.description,
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}
    >
      <body className="overflow-x-hidden">
        <NextTopLoader
          color="#2670DC"
          height={2}
          showSpinner={false}
          shadow={false}
        />
        <WagmiProviders>
          <WalletProvider>
            <SkipToContentLink />
            <ScrollToTopOnLoad />
            <Header />
            <main
              id="main-content"
              tabIndex={-1}
              className="mx-auto min-w-0 max-w-[1200px] px-4 pb-8 pt-[calc(3.5rem+env(safe-area-inset-top)+1rem)] sm:px-6 sm:pb-8 sm:pt-[calc(3.5rem+env(safe-area-inset-top)+1.5rem)] lg:px-8"
            >
              {children}
            </main>
            <Footer />
            <Toaster
              position="bottom-center"
              theme="light"
              toastOptions={{
                style: {
                  background: "#FFFFFF",
                  border: "1px solid rgba(189,215,255,0.28)",
                  color: "#002259",
                  borderRadius: 16,
                  fontFamily: "var(--font-body)",
                  boxShadow: "inset -2px -2px 4px rgba(235,243,255,0.75), inset 2px 2px 4px rgba(235,243,255,0.75)",
                },
              }}
            />
          </WalletProvider>
        </WagmiProviders>
      </body>
    </html>
  );
}

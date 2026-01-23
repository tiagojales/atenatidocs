/**
 * @file This file defines the root layout for the entire application.
 * It's a server component that wraps all pages with a consistent HTML structure,
 * including the Navbar, Footer, and global styles. It also configures and applies
 * the primary font for the application using next/font for optimal performance.
 */

import type {Metadata} from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';

// The Inter font is loaded via next/font, which is the recommended
// way to handle fonts in Next.js. It automatically self-hosts the font files,
// reducing external network requests and preventing layout shifts.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'aDocs - Ferramentas de Documentos Online',
  description: 'AtenaDocs oferece ferramentas online gratuitas para trabalhar com documentos, como juntar arquivos PDF.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="flex min-h-screen flex-col font-body antialiased">
        <Navbar />
        <main className="flex-1">
          {children}
        </main>
        <Footer />
        {/* The Toaster component is included here to be available globally for displaying notifications. */}
        <Toaster />
      </body>
    </html>
  );
}

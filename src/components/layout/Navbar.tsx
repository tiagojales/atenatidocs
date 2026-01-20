import Link from "next/link";
import Image from "next/image";
import logo from "@/assets/logo.png";

/**
 * Represents the shared navigation bar for the application.
 * It is displayed at the top of all pages and includes the main branding/logo
 * which links back to the home page.
 */
export function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b backdrop-blur">
      <div className="container flex h-16 items-center px-4">
        <div className="flex flex-1 items-center justify-start">
          <Link href="/" className="flex items-center space-x-2">
            <Image
              src={logo}
              alt="AtenaDocs Logo"
              height={25}
              priority
              className="dark:invert"
            />
          </Link>
        </div>
      </div>
    </header>
  );
}

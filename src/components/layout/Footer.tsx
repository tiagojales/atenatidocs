/**
 * Represents the shared footer for the application.
 * It is displayed on all pages and contains attribution and links.
 */
export function Footer() {
  return (
    <footer className="w-full border-t">
      <div className="container mx-auto flex h-24 items-center justify-between text-sm text-muted-foreground">
        <p>
          Desenvolvido por{" "}
          <a
            href="https://www.linkedin.com/in/tiago-jales-118886121/"
            target="_blank"
            rel="noreferrer"
            className="font-medium underline underline-offset-4"
          >
            Tiago Jales
          </a>
          .
        </p>
        <p>
          Versão:{" "}
          <a
            href="https://github.com/tiagojales/atenatidocs.git"
            target="_blank"
            rel="noreferrer"
            className="font-medium underline underline-offset-4"
          >
            0.1.2-dev
          </a>
        </p>
      </div>
    </footer>
  );
}

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Combine, ArrowRight } from "lucide-react";
import Link from "next/link";

/**
 * The main home page for the AtenaDocs application.
 * It serves as a central hub, presenting the available document tools to the user.
 * Each tool is displayed as a card, allowing for easy navigation.
 */
export default function Home() {
  return (
    <div className="container py-12 mx-auto px-4 sm:py-16">
      <div className="w-full max-w-5xl text-center mx-auto">
        <div className="flex items-center justify-center gap-3 mb-6">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Tudo o que você precisa para trabalhar com PDFs em um só lugar
            </h2>
        </div>
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          Todas as ferramentas para usar PDFs na palma da sua mão.
        </p>
        <section className="mt-16">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground text-left mb-6">
            Ferramentas de PDF
          </h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <Link href="/pdf/merge" className="group block rounded-lg">
                <Card className="text-left h-full transition-all border-border group-hover:border-primary/50 group-hover:bg-primary/5 flex flex-col">
                    <CardHeader>
                    <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                        <Combine className="h-6 w-6 text-primary" />
                        </div>
                        <CardTitle>Juntar PDFs</CardTitle>
                    </div>
                    </CardHeader>
                    <CardContent className="flex-grow">
                    <CardDescription>
                        Combine múltiplos arquivos PDF em um único documento de forma fácil e rápida. Arraste, solte e junte.
                    </CardDescription>
                    </CardContent>
                    <div className="p-6 pt-0 mt-auto flex justify-end">
                        <ArrowRight className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-primary" />
                    </div>
                </Card>
            </Link>
            {/* This placeholder card is for future tools. It visually indicates that more features are planned. */}
            <Card className="text-left border-dashed flex flex-col items-center justify-center bg-card/50">
                 <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">Em breve...</p>
                 </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </div>
  );
}

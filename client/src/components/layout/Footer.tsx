import { content } from "@/data/content";

interface FooterProps {
  content: any;
}

export function Footer({ content }: FooterProps) {
  return (
    <footer className="bg-foreground text-background py-12 border-t border-white/10">
      <div className="container px-4 md:px-6 mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="text-2xl font-serif font-bold tracking-tighter">
          JJ.
        </div>
        
        <div className="flex gap-8 text-sm font-mono text-background/60">
          {content.links.map((link: string, i: number) => (
            <a key={i} href="#" className="hover:text-white transition-colors">
              {link}
            </a>
          ))}
        </div>

        <div className="text-xs text-background/40 font-light">
          {content.copyright}
        </div>
      </div>
    </footer>
  );
}

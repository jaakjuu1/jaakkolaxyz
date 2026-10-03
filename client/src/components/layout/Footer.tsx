import { Link } from "wouter";

interface FooterLink {
  label: string;
  url: string;
}

interface FooterProps {
  content: {
    copyright: string;
    links: FooterLink[];
  };
}

export function Footer({ content }: FooterProps) {
  return (
    <footer className="bg-foreground text-background py-12 border-t border-white/10">
      <div className="container px-4 md:px-6 mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="text-2xl font-serif font-bold tracking-tighter">
          JJ.
        </div>
        
        <div className="flex gap-8 text-sm font-mono text-background/60">
          {content.links.map((link, i) =>
            link.url.startsWith("/") ? (
              <Link key={i} href={link.url} className="hover:text-white transition-colors">
                {link.label}
              </Link>
            ) : (
              <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
                {link.label}
              </a>
            ),
          )}
        </div>

        <div className="text-xs text-background/40 font-light">
          {content.copyright}
        </div>
      </div>
    </footer>
  );
}

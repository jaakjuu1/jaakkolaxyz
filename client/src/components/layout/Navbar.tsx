import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Moon, Sun, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NavbarProps {
  lang: "fi" | "en";
  setLang: (lang: "fi" | "en") => void;
}

export function Navbar({ lang, setLang }: NavbarProps) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme("dark");
      document.documentElement.classList.add("dark");
    }
  }, []);

  const toggleTheme = () => {
    if (theme === "light") {
      setTheme("dark");
      document.documentElement.classList.add("dark");
    } else {
      setTheme("light");
      document.documentElement.classList.remove("dark");
    }
  };

  const toggleLang = () => {
    setLang(lang === "fi" ? "en" : "fi");
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-background/80 backdrop-blur-md border-b border-border/50 transition-all duration-300">
      <div className="flex items-center gap-2">
        <Link href="/">
          <span className="text-xl font-serif font-bold tracking-tighter hover:opacity-80 transition-opacity cursor-pointer">
            JJ.
          </span>
        </Link>
      </div>

      <div className="flex items-center gap-4">
        <Link href="/blog">
          <Button variant="ghost" size="sm" className="text-sm font-medium hover:bg-secondary/50 transition-colors">
            {lang === 'fi' ? 'Blogi' : 'Blog'}
          </Button>
        </Link>

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleLang}
          className="rounded-full hover:bg-secondary/50 transition-colors"
          data-testid="button-lang-toggle"
        >
          <span className="text-xs font-medium font-mono uppercase w-6">{lang}</span>
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="rounded-full hover:bg-secondary/50 transition-colors"
          data-testid="button-theme-toggle"
        >
          {theme === "light" ? (
            <Moon className="h-4 w-4" />
          ) : (
            <Sun className="h-4 w-4" />
          )}
        </Button>
        
        <a href="#lead-capture">
          <Button variant="default" size="sm" className="hidden sm:inline-flex rounded-full px-6 font-medium">
            {lang === 'fi' ? 'Ota yhteyttä' : 'Contact'}
          </Button>
        </a>
      </div>
    </nav>
  );
}

import { useEffect } from "react";
import { content } from "@/data/content";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useLanguage } from "@/hooks/useLanguage";

interface PrivacySection {
  heading: string;
  body: string[];
  items?: string[];
  after?: string[];
}

export default function Privacy() {
  const { lang, setLang } = useLanguage();
  const t = content[lang];
  const privacy = t.privacy as { title: string; updated: string; sections: PrivacySection[] };

  useEffect(() => {
    const previous = document.title;
    document.title = `${privacy.title} | Juuso Jaakkola`;
    return () => {
      document.title = previous;
    };
  }, [privacy.title]);

  return (
    <div className="min-h-screen w-full bg-background text-foreground font-sans selection:bg-primary selection:text-primary-foreground">
      <Navbar lang={lang} setLang={setLang} />

      <main className="pt-24 pb-16">
        <section className="py-16">
          <div className="container px-4 md:px-6 max-w-3xl mx-auto">
            <h1 className="text-4xl md:text-5xl font-serif mb-3" data-testid="text-privacy-title">
              {privacy.title}
            </h1>
            <p className="text-sm text-muted-foreground mb-12">{privacy.updated}</p>

            <div className="space-y-10">
              {privacy.sections.map((section) => (
                <div key={section.heading}>
                  <h2 className="text-2xl font-serif mb-3">{section.heading}</h2>
                  <div className="space-y-3 text-muted-foreground leading-relaxed">
                    {section.body.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                    {section.items && (
                      <ul className="list-disc pl-6 space-y-1">
                        {section.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    )}
                    {section.after?.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer content={t.footer} />
    </div>
  );
}

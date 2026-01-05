import { content } from "@/data/content";
import { Navbar } from "@/components/layout/Navbar";
import { Hero } from "@/components/sections/Hero";
import { Services } from "@/components/sections/Services";
import { CaseStudies } from "@/components/sections/CaseStudies";
import { Process } from "@/components/sections/Process";
import { About } from "@/components/sections/About";
import { LeadCapture } from "@/components/sections/LeadCapture";
import { Footer } from "@/components/layout/Footer";
import { useLanguage } from "@/hooks/useLanguage";

export default function Home() {
  const { lang, setLang } = useLanguage();
  const t = content[lang];

  return (
    <div className="min-h-screen w-full bg-background text-foreground font-sans selection:bg-primary selection:text-primary-foreground">
      <Navbar lang={lang} setLang={setLang} />
      
      <main>
        <Hero content={t.hero} />
        <Services content={t.services} />
        <CaseStudies content={t.cases} />
        <Process content={t.process} />
        <About content={t.about} />
        <LeadCapture content={t.leadCapture} />
      </main>

      <Footer content={t.footer} />
    </div>
  );
}

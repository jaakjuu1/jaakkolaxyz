import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import heroBg from "@assets/generated_images/minimalist_abstract_geometric_background_with_subtle_lighting.png";

interface HeroProps {
  content: any;
}

export function Hero({ content }: HeroProps) {
  return (
    <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden pt-20">
      {/* Background Image with Overlay */}
      <div className="absolute inset-0 z-0">
        <img 
          src={heroBg} 
          alt="Abstract Background" 
          className="w-full h-full object-cover opacity-80 dark:opacity-40 grayscale-[20%]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/50 to-background z-10" />
      </div>

      <div className="container relative z-20 px-4 md:px-6 flex flex-col items-center text-center max-w-4xl mx-auto space-y-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="space-y-4"
        >
          <span className="inline-block py-1 px-3 rounded-full bg-secondary/80 backdrop-blur-sm text-secondary-foreground text-xs font-mono tracking-wider uppercase border border-border/50">
            System Thinker & Developer
          </span>
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-serif font-medium leading-[1.1] tracking-tight text-foreground">
            {content.headline}
          </h1>
        </motion.div>

        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
          className="text-lg md:text-xl text-muted-foreground max-w-2xl leading-relaxed font-light"
        >
          {content.subheadline}
        </motion.p>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
          className="flex flex-col sm:flex-row gap-4 items-center justify-center w-full sm:w-auto"
        >
          <a href={content.bookingUrl} target="_blank" rel="noopener noreferrer" className="w-full sm:w-auto">
            <Button size="lg" className="rounded-full w-full h-12 px-8 text-base shadow-lg hover:shadow-xl transition-all duration-300 group">
              {content.cta_primary}
              <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </Button>
          </a>
          <a href="#cases" className="w-full sm:w-auto">
            <Button variant="outline" size="lg" className="rounded-full w-full h-12 px-8 text-base bg-background/50 backdrop-blur-sm border-primary/10 hover:bg-background/80 transition-all duration-300">
              {content.cta_secondary}
            </Button>
          </a>
        </motion.div>
      </div>

      {/* Scroll Indicator */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1, duration: 1 }}
        className="absolute bottom-10 left-1/2 -translate-x-1/2 hidden md:flex flex-col items-center gap-2"
      >
        <div className="w-[1px] h-12 bg-gradient-to-b from-transparent to-foreground/30" />
      </motion.div>
    </section>
  );
}

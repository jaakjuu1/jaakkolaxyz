import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Check, ArrowRight } from "lucide-react";

interface CaseStudiesProps {
  content: any;
}

export function CaseStudies({ content }: CaseStudiesProps) {
  return (
    <section id="cases" className="py-24 bg-background">
      <div className="container px-4 md:px-6 max-w-6xl mx-auto">
        <div className="mb-16 md:text-center">
          <h2 className="text-3xl md:text-4xl font-serif mb-6">{content.title}</h2>
          <div className="h-1 w-20 bg-primary/10 md:mx-auto rounded-full" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {content.items.map((item: any, index: number) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, scale: 0.98 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1, duration: 0.6 }}
              className={index === 2 ? "md:col-span-2 md:w-2/3 md:mx-auto" : ""}
            >
              <Card className="h-full overflow-hidden border-border bg-secondary/10 hover:bg-secondary/20 transition-colors">
                <CardContent className="p-8 space-y-6">
                  <div className="flex justify-between items-start">
                    <h3 className="text-2xl font-serif">{item.client}</h3>
                    <div className="p-2 bg-background rounded-full border border-border/50">
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
                    <div>
                      <h4 className="text-xs font-mono uppercase text-muted-foreground mb-2">Challenge</h4>
                      <p className="text-sm">{item.challenge}</p>
                    </div>
                    <div>
                      <h4 className="text-xs font-mono uppercase text-muted-foreground mb-2">Solution</h4>
                      <p className="text-sm">{item.solution}</p>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-border/30">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="bg-green-500/10 text-green-600 rounded-full p-1">
                        <Check className="h-3 w-3" />
                      </div>
                      <span className="font-medium">{item.result}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs font-mono text-muted-foreground">
                      {item.stack.map((tech: string, i: number) => (
                        <span key={i}># {tech}</span>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

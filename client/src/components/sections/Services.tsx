import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import aiSymbol from "@assets/generated_images/abstract_geometric_symbol_for_ai_automation.png";
import webSymbol from "@assets/generated_images/abstract_geometric_symbol_for_web_development.png";
import dataSymbol from "@assets/generated_images/abstract_geometric_symbol_for_analytics_and_data.png";

interface ServicesProps {
  content: any;
}

const symbols = [aiSymbol, webSymbol, dataSymbol, aiSymbol, webSymbol]; // Recycle for demo

export function Services({ content }: ServicesProps) {
  return (
    <section id="services" className="py-24 bg-secondary/30 relative">
      <div className="container px-4 md:px-6 max-w-6xl mx-auto">
        <div className="mb-16 md:text-center max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-serif mb-6">{content.title}</h2>
          <div className="h-1 w-20 bg-primary/10 md:mx-auto rounded-full" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {content.items.map((item: any, index: number) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1, duration: 0.5 }}
            >
              <Card className="h-full border-border/40 bg-card/50 backdrop-blur-sm hover:shadow-lg hover:border-primary/20 transition-all duration-300 group overflow-hidden">
                <CardHeader className="pb-4 relative">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                    <img 
                      src={symbols[index % symbols.length]} 
                      alt="" 
                      className="w-16 h-16 object-contain"
                    />
                  </div>
                  <CardTitle className="text-xl font-medium relative z-10">{item.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6 relative z-10">
                  <CardDescription className="text-base leading-relaxed">
                    {item.description}
                  </CardDescription>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {item.tags.map((tag: string, i: number) => (
                      <Badge 
                        key={i} 
                        variant="secondary" 
                        className="rounded-md font-mono text-[10px] uppercase tracking-wider bg-secondary/50 hover:bg-secondary border border-transparent hover:border-border transition-colors"
                      >
                        {tag}
                      </Badge>
                    ))}
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

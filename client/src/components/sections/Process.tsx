import { motion } from "framer-motion";

interface ProcessProps {
  content: any;
}

export function Process({ content }: ProcessProps) {
  return (
    <section className="py-24 bg-foreground text-background overflow-hidden relative">
      {/* Abstract bg element */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-background/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
      
      <div className="container px-4 md:px-6 max-w-6xl mx-auto relative z-10">
        <div className="mb-20">
          <h2 className="text-3xl md:text-4xl font-serif mb-6">{content.title}</h2>
          <div className="h-1 w-20 bg-background/20 rounded-full" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
          {/* Connecting line */}
          <div className="hidden md:block absolute top-12 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-background/20 to-transparent" />

          {content.steps.map((step: any, index: number) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.2, duration: 0.6 }}
              className="relative"
            >
              <div className="flex flex-col gap-6">
                <div className="w-24 h-24 rounded-full border border-background/20 bg-foreground flex items-center justify-center text-4xl font-serif italic relative z-10">
                  {step.step}
                </div>
                <div>
                  <h3 className="text-xl font-medium mb-3">{step.name}</h3>
                  <p className="text-background/70 leading-relaxed font-light">
                    {step.description}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

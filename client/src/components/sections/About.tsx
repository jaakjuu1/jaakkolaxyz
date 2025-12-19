import { motion } from "framer-motion";
import { Quote } from "lucide-react";

interface AboutProps {
  content: any;
}

export function About({ content }: AboutProps) {
  return (
    <section className="py-24 bg-secondary/20">
      <div className="container px-4 md:px-6 max-w-4xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="space-y-8"
        >
          <Quote className="h-12 w-12 mx-auto text-primary/20 rotate-180" />
          
          <h2 className="text-2xl md:text-4xl font-serif italic leading-relaxed md:leading-relaxed">
            "{content.text}"
          </h2>
          
          <div className="pt-4">
            <span className="text-lg font-mono font-medium tracking-widest uppercase border-t border-primary/20 pt-4 inline-block px-8">
              {content.signature}
            </span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

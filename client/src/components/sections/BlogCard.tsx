import { motion } from "framer-motion";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";

interface BlogPost {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  tags: string[];
}

interface BlogCardProps {
  post: BlogPost;
  index: number;
}

export function BlogCard({ post, index }: BlogCardProps) {
  const formattedDate = new Date(post.date).toLocaleDateString("fi-FI", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.1, duration: 0.5 }}
    >
      <Link href={`/blog/${post.slug}`}>
        <Card className="h-full overflow-hidden border-border bg-secondary/10 hover:bg-secondary/20 transition-colors cursor-pointer group">
          <CardContent className="p-8 space-y-4">
            <div className="flex justify-between items-start">
              <time className="text-xs font-mono text-muted-foreground">
                {formattedDate}
              </time>
              <div className="p-2 bg-background rounded-full border border-border/50 group-hover:border-primary/30 transition-colors">
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
            </div>

            <h3 className="text-xl font-serif group-hover:text-primary transition-colors">
              {post.title}
            </h3>

            <p className="text-sm text-muted-foreground line-clamp-3">
              {post.excerpt}
            </p>

            {post.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {post.tags.map((tag, i) => (
                  <span
                    key={i}
                    className="text-xs font-mono text-muted-foreground bg-secondary/50 px-2 py-1 rounded"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}

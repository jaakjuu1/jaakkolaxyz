import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { content } from "@/data/content";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { BlogCard } from "@/components/sections/BlogCard";
import { Skeleton } from "@/components/ui/skeleton";
import { useLanguage } from "@/hooks/useLanguage";

interface BlogPost {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  tags: string[];
}

export default function Blog() {
  const { lang, setLang } = useLanguage();
  const t = content[lang];

  const { data, isLoading } = useQuery<{ success: boolean; data: BlogPost[] }>({
    queryKey: ["/api/blog/posts", lang],
    queryFn: async () => {
      const res = await fetch(`/api/blog/posts?lang=${lang}`);
      return res.json();
    },
  });

  const posts = data?.data || [];

  return (
    <div className="min-h-screen w-full bg-background text-foreground font-sans selection:bg-primary selection:text-primary-foreground">
      <Navbar lang={lang} setLang={setLang} />

      <main className="pt-24 pb-16">
        <section className="py-16 bg-background">
          <div className="container px-4 md:px-6 max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="mb-16"
            >
              <h1 className="text-4xl md:text-5xl font-serif mb-4">
                {lang === "fi" ? "Blogi" : "Blog"}
              </h1>
              <p className="text-lg text-muted-foreground">
                {lang === "fi"
                  ? "Ajatuksia web-kehityksesta, automaatiosta ja teknologiasta."
                  : "Thoughts on web development, automation, and technology."}
              </p>
              <div className="h-1 w-20 bg-primary/10 mt-6 rounded-full" />
            </motion.div>

            {isLoading ? (
              <div className="grid grid-cols-1 gap-6">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="space-y-4 p-8 border rounded-lg">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ))}
              </div>
            ) : posts.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-16 text-muted-foreground"
              >
                {lang === "fi"
                  ? "Ei viela kirjoituksia."
                  : "No posts yet."}
              </motion.div>
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {posts.map((post, index) => (
                  <BlogCard key={post.slug} post={post} index={index} />
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      <Footer content={t.footer} />
    </div>
  );
}

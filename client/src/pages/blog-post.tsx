import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { content } from "@/data/content";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/useLanguage";

interface BlogPostData {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  tags: string[];
  content: string;
}

export default function BlogPost() {
  const { lang, setLang } = useLanguage();
  const t = content[lang];
  const params = useParams<{ slug: string }>();

  const { data, isLoading, error } = useQuery<{ success: boolean; data: BlogPostData }>({
    queryKey: ["/api/blog/posts", params.slug, lang],
    queryFn: async () => {
      const res = await fetch(`/api/blog/posts/${params.slug}?lang=${lang}`);
      if (!res.ok) {
        throw new Error("Post not found");
      }
      return res.json();
    },
  });

  const post = data?.data;

  const formattedDate = post
    ? new Date(post.date).toLocaleDateString(lang === "fi" ? "fi-FI" : "en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <div className="min-h-screen w-full bg-background text-foreground font-sans selection:bg-primary selection:text-primary-foreground">
      <Navbar lang={lang} setLang={setLang} />

      <main className="pt-24 pb-16">
        <article className="py-16 bg-background">
          <div className="container px-4 md:px-6 max-w-3xl mx-auto">
            <Link href="/blog">
              <Button variant="ghost" size="sm" className="mb-8 -ml-2 text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4 mr-2" />
                {lang === "fi" ? "Takaisin blogiin" : "Back to blog"}
              </Button>
            </Link>

            {isLoading ? (
              <div className="space-y-6">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-6 w-3/4" />
                <div className="space-y-4 pt-8">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </div>
            ) : error ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-16"
              >
                <h1 className="text-2xl font-serif mb-4">
                  {lang === "fi" ? "Kirjoitusta ei loydy" : "Post not found"}
                </h1>
                <p className="text-muted-foreground mb-8">
                  {lang === "fi"
                    ? "Etsimääsi kirjoitusta ei ole olemassa."
                    : "The post you're looking for doesn't exist."}
                </p>
                <Link href="/blog">
                  <Button>
                    {lang === "fi" ? "Palaa blogiin" : "Return to blog"}
                  </Button>
                </Link>
              </motion.div>
            ) : post ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
              >
                <header className="mb-12">
                  <time className="text-sm font-mono text-muted-foreground">
                    {formattedDate}
                  </time>
                  <h1 className="text-3xl md:text-4xl font-serif mt-4 mb-6">
                    {post.title}
                  </h1>
                  {post.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
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
                  <div className="h-1 w-20 bg-primary/10 mt-8 rounded-full" />
                </header>

                <div
                  className="prose prose-neutral dark:prose-invert max-w-none
                    prose-headings:font-serif prose-headings:font-normal
                    prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl
                    prose-p:text-base prose-p:leading-relaxed
                    prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                    prose-strong:font-semibold
                    prose-code:text-sm prose-code:bg-secondary/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded
                    prose-pre:bg-secondary/30 prose-pre:border prose-pre:border-border
                    prose-blockquote:border-l-primary/30 prose-blockquote:italic
                    prose-ul:list-disc prose-ol:list-decimal
                    prose-li:text-base"
                  dangerouslySetInnerHTML={{ __html: post.content }}
                />
              </motion.div>
            ) : null}
          </div>
        </article>
      </main>

      <Footer content={t.footer} />
    </div>
  );
}

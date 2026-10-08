import type { Express } from "express";
import { createServer, type Server } from "http";
import { createContactHandler, createDefaultContactDeps, createRateLimiter } from "./contact";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";

// Configure marked with syntax highlighting
const marked = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language }).value;
    },
  })
);

// Blog post interface
interface BlogPost {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  tags: string[];
  content: string;
}

const BLOG_LANGS = new Set(["fi", "en"]);
const BLOG_SLUG = /^[a-z0-9][a-z0-9-]*$/i;

// Get blog posts directory; null for anything but a known language, so the
// query string can never point the reader outside content/blog/.
export function getBlogDir(lang: unknown): string | null {
  if (typeof lang !== "string" || !BLOG_LANGS.has(lang)) return null;
  return path.join(process.cwd(), "content", "blog", lang);
}

export function isBlogSlug(slug: string): boolean {
  return BLOG_SLUG.test(slug);
}

// Parse a markdown file
function parseBlogPost(filePath: string, slug: string): BlogPost | null {
  try {
    const fileContent = fs.readFileSync(filePath, "utf-8");
    const { data, content } = matter(fileContent);
    const htmlContent = marked.parse(content) as string;

    return {
      slug,
      title: data.title || "Untitled",
      date: data.date || new Date().toISOString(),
      excerpt: data.excerpt || "",
      tags: data.tags || [],
      content: htmlContent,
    };
  } catch {
    return null;
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Get all blog posts for a language
  app.get("/api/blog/posts", (req, res) => {
    try {
      const blogDir = getBlogDir(req.query.lang ?? "en");
      if (!blogDir) {
        return res.status(400).json({ success: false, message: "Unknown language" });
      }

      if (!fs.existsSync(blogDir)) {
        return res.json({ success: true, data: [] });
      }

      const files = fs.readdirSync(blogDir).filter((f) => f.endsWith(".md"));
      const posts: Omit<BlogPost, "content">[] = [];

      for (const file of files) {
        const slug = file.replace(".md", "");
        const filePath = path.join(blogDir, file);
        const post = parseBlogPost(filePath, slug);
        if (post) {
          const { content, ...postWithoutContent } = post;
          posts.push(postWithoutContent);
        }
      }

      // Sort by date descending
      posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      res.json({ success: true, data: posts });
    } catch (error) {
      console.error("Error fetching blog posts:", error);
      res.status(500).json({ success: false, message: "Failed to fetch posts" });
    }
  });

  // Get a single blog post
  app.get("/api/blog/posts/:slug", (req, res) => {
    try {
      const { slug } = req.params;
      const blogDir = getBlogDir(req.query.lang ?? "en");
      if (!blogDir || !isBlogSlug(slug)) {
        return res.status(404).json({ success: false, message: "Post not found" });
      }
      const filePath = path.join(blogDir, `${slug}.md`);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, message: "Post not found" });
      }

      const post = parseBlogPost(filePath, slug);
      if (!post) {
        return res.status(500).json({ success: false, message: "Failed to parse post" });
      }

      res.json({ success: true, data: post });
    } catch (error) {
      console.error("Error fetching blog post:", error);
      res.status(500).json({ success: false, message: "Failed to fetch post" });
    }
  });

  app.post(
    "/api/contact",
    createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5 }),
    createContactHandler(createDefaultContactDeps()),
  );

  return httpServer;
}

import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertContactSubmissionSchema } from "@shared/schema";
import { fromZodError } from "zod-validation-error";
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

// Get blog posts directory
function getBlogDir(lang: string): string {
  return path.join(process.cwd(), "content", "blog", lang);
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
      const lang = (req.query.lang as string) || "en";
      const blogDir = getBlogDir(lang);

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
      const lang = (req.query.lang as string) || "en";
      const { slug } = req.params;
      const blogDir = getBlogDir(lang);
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

  app.post("/api/contact", async (req, res) => {
    try {
      const validatedData = insertContactSubmissionSchema.parse(req.body);
      const submission = await storage.createContactSubmission(validatedData);
      
      res.status(201).json({
        success: true,
        message: "Contact form submitted successfully",
        data: submission,
      });
    } catch (error: any) {
      if (error.name === "ZodError") {
        const validationError = fromZodError(error);
        return res.status(400).json({
          success: false,
          message: "Validation error",
          error: validationError.message,
        });
      }
      
      console.error("Error submitting contact form:", error);
      res.status(500).json({
        success: false,
        message: "Failed to submit contact form",
      });
    }
  });

  app.get("/api/contact/submissions", async (req, res) => {
    try {
      const submissions = await storage.getAllContactSubmissions();
      res.json({
        success: true,
        data: submissions,
      });
    } catch (error) {
      console.error("Error fetching contact submissions:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch contact submissions",
      });
    }
  });

  return httpServer;
}

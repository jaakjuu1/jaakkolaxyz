import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertContactSubmissionSchema } from "@shared/schema";
import { fromZodError } from "zod-validation-error";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { marked } from "marked";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
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

  // Blog API endpoints
  const BLOG_DIR = path.join(process.cwd(), "content", "blog");

  app.get("/api/blog/posts", async (req, res) => {
    try {
      const lang = (req.query.lang as string) || "en";
      const langDir = path.join(BLOG_DIR, lang);

      if (!fs.existsSync(langDir)) {
        return res.json({ success: true, data: [] });
      }

      const files = fs.readdirSync(langDir).filter((f) => f.endsWith(".md"));
      const posts = files.map((filename) => {
        const filePath = path.join(langDir, filename);
        const fileContent = fs.readFileSync(filePath, "utf-8");
        const { data } = matter(fileContent);
        const slug = filename.replace(".md", "");

        return {
          slug,
          title: data.title || slug,
          date: data.date || "",
          excerpt: data.excerpt || "",
          tags: data.tags || [],
        };
      });

      // Sort by date (newest first)
      posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      res.json({ success: true, data: posts });
    } catch (error) {
      console.error("Error fetching blog posts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch blog posts",
      });
    }
  });

  app.get("/api/blog/posts/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      const lang = (req.query.lang as string) || "en";
      const filePath = path.join(BLOG_DIR, lang, `${slug}.md`);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          message: "Post not found",
        });
      }

      const fileContent = fs.readFileSync(filePath, "utf-8");
      const { data, content } = matter(fileContent);
      const htmlContent = await marked(content);

      res.json({
        success: true,
        data: {
          slug,
          title: data.title || slug,
          date: data.date || "",
          excerpt: data.excerpt || "",
          tags: data.tags || [],
          content: htmlContent,
        },
      });
    } catch (error) {
      console.error("Error fetching blog post:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch blog post",
      });
    }
  });

  return httpServer;
}

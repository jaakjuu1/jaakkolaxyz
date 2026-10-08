import type { APIRoute } from "astro";
import { renderBlogFeed } from "../../utils/rss";

export const GET: APIRoute = ({ site }) => renderBlogFeed("en", site);

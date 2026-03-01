import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getTecDocService } from "../services/tecdoc.js";

export async function tecdocRoutes(app: FastifyInstance): Promise<void> {
  app.get("/tecdoc/search", async (request, reply) => {
    const schema = z.object({
      q: z.string().min(1).max(200),
      type: z.enum(["article", "oem", "ean", "text"]).default("text"),
      brandId: z.coerce.number().int().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    });

    const parsed = schema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Bad Request",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { q, type, brandId, page, limit } = parsed.data;
    const tecdoc = getTecDocService();

    try {
      switch (type) {
        case "article": {
          const articles = await tecdoc.searchByArticleNumber(q, brandId);
          return reply.send({ articles, total: articles.length });
        }
        case "oem": {
          const articles = await tecdoc.searchByOemNumber(q);
          return reply.send({ articles, total: articles.length });
        }
        case "ean": {
          const articles = await tecdoc.searchByEan(q);
          return reply.send({ articles, total: articles.length });
        }
        case "text":
        default: {
          const result = await tecdoc.searchFreeText(q, page, limit);
          return reply.send(result);
        }
      }
    } catch (err) {
      request.log.error({ err }, "TecDoc search error");
      return reply.code(502).send({
        error: "TecDoc API error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  });
}

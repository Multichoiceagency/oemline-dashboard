import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import path from "node:path";
import multipart from "@fastify/multipart";
import { prisma } from "../lib/prisma.js";
import { uploadFile, deleteFile, getPresignedUploadUrl, listObjects, getBucketStats } from "../lib/minio.js";
import { config } from "../config.js";

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);
const ALLOWED_TYPES = new Set([
  ...IMAGE_TYPES,
  "text/csv",
  "text/plain",
  "application/json",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/gzip",
  "application/octet-stream",
]);

function generateObjectName(folder: string, originalName: string): string {
  const ext = path.extname(originalName).toLowerCase() || ".jpg";
  const id = crypto.randomUUID().slice(0, 12);
  return `images/${folder}/${id}${ext}`;
}

export async function uploadRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: { fileSize: MAX_FILE_SIZE },
  });

  // Upload any file to a folder
  app.post("/uploads/general", async (request, reply) => {
    if (!config.MINIO_ACCESS_KEY) {
      return reply.code(503).send({ error: "File storage not configured" });
    }

    const { folder } = request.query as { folder?: string };
    const targetFolder = folder ?? "files";

    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "No file uploaded" });
    }

    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return reply.code(400).send({ error: `Invalid file type: ${file.mimetype}` });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of file.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Keep original filename for non-image files
    const ext = path.extname(file.filename).toLowerCase();
    const id = crypto.randomUUID().slice(0, 8);
    const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectName = `${targetFolder}/${id}-${safeName}`;
    const url = await uploadFile(buffer, objectName, file.mimetype);

    return { url, objectName, filename: file.filename, size: buffer.length };
  });

  // Upload a product image
  app.post("/uploads/product/:id", async (request, reply) => {
    if (!config.MINIO_ACCESS_KEY) {
      return reply.code(503).send({ error: "File storage not configured" });
    }

    const { id } = request.params as { id: string };
    const productId = parseInt(id, 10);

    const product = await prisma.productMap.findUnique({ where: { id: productId } });
    if (!product) {
      return reply.code(404).send({ error: "Product not found" });
    }

    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "No file uploaded" });
    }

    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return reply.code(400).send({ error: `Invalid file type: ${file.mimetype}` });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of file.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const objectName = generateObjectName("products", file.filename);
    const url = await uploadFile(buffer, objectName, file.mimetype);

    // Add the new upload to the gallery and promote it to primary —
    // the dashboard upload button sits on the main image preview, so
    // users expect the visible image to change after clicking Upload.
    // Older behaviour kept the previous imageUrl when one existed,
    // which made the optimistic frontend update silently revert on
    // the next page-load.
    const currentImages = (product.images as string[] | null) ?? [];
    const updatedImages = currentImages.includes(url) ? currentImages : [...currentImages, url];

    await prisma.productMap.update({
      where: { id: productId },
      data: {
        images: updatedImages,
        imageUrl: url,
      },
    });

    return { url, objectName, images: updatedImages, imageUrl: url };
  });

  // Upload a brand logo
  app.post("/uploads/brand/:id", async (request, reply) => {
    if (!config.MINIO_ACCESS_KEY) {
      return reply.code(503).send({ error: "File storage not configured" });
    }

    const { id } = request.params as { id: string };
    const brandId = parseInt(id, 10);

    const brand = await prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) {
      return reply.code(404).send({ error: "Brand not found" });
    }

    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "No file uploaded" });
    }

    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return reply.code(400).send({ error: `Invalid file type: ${file.mimetype}` });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of file.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const objectName = generateObjectName("brands", file.filename);
    const url = await uploadFile(buffer, objectName, file.mimetype);

    await prisma.brand.update({
      where: { id: brandId },
      data: { logoUrl: url },
    });

    return { url, objectName };
  });

  // Generic upload (returns URL, caller decides what to do with it)
  app.post("/uploads/file", async (request, reply) => {
    if (!config.MINIO_ACCESS_KEY) {
      return reply.code(503).send({ error: "File storage not configured" });
    }

    const folder = (request.query as { folder?: string }).folder ?? "misc";

    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "No file uploaded" });
    }

    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return reply.code(400).send({ error: `Invalid file type: ${file.mimetype}` });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of file.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const objectName = generateObjectName(folder, file.filename);
    const url = await uploadFile(buffer, objectName, file.mimetype);

    return { url, objectName };
  });

  // Delete a file
  app.delete("/uploads/file", async (request, reply) => {
    if (!config.MINIO_ACCESS_KEY) {
      return reply.code(503).send({ error: "File storage not configured" });
    }

    const { objectName } = request.query as { objectName?: string };
    if (!objectName) {
      return reply.code(400).send({ error: "objectName query param required" });
    }

    await deleteFile(objectName);
    return { deleted: true, objectName };
  });

  // List files in storage
  app.get("/uploads/list", async (request, reply) => {
    if (!config.MINIO_ACCESS_KEY) {
      return reply.code(503).send({ error: "File storage not configured" });
    }

    const { prefix } = request.query as { prefix?: string };
    const objects = await listObjects(prefix ?? "");
    const items = objects.map((obj) => ({
      name: obj.name,
      size: obj.size,
      lastModified: obj.lastModified,
      url: `${config.MINIO_PUBLIC_URL}/${config.MINIO_BUCKET}/${obj.name}`,
    }));

    return { items, total: items.length };
  });

  // Get storage stats
  app.get("/uploads/stats", async (request, reply) => {
    if (!config.MINIO_ACCESS_KEY) {
      return reply.code(503).send({ error: "File storage not configured" });
    }

    const stats = await getBucketStats();
    return stats;
  });

  // Get presigned upload URL (for client-side direct upload)
  app.get("/uploads/presign", async (request, reply) => {
    if (!config.MINIO_ACCESS_KEY) {
      return reply.code(503).send({ error: "File storage not configured" });
    }

    const { filename, folder } = request.query as { filename?: string; folder?: string };
    if (!filename) {
      return reply.code(400).send({ error: "filename query param required" });
    }

    const objectName = generateObjectName(folder ?? "misc", filename);
    const uploadUrl = await getPresignedUploadUrl(objectName);
    const publicUrl = `${config.MINIO_PUBLIC_URL}/${config.MINIO_BUCKET}/${objectName}`;

    return { uploadUrl, publicUrl, objectName };
  });
}

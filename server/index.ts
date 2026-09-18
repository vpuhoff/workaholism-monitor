import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash } from "node:crypto";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client.ts";
import { BATCH_SIZE, CODE_PATTERN, isLogEvent } from "../shared/events.ts";

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL || "file:./dev.db",
  }),
});
await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL");
await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 5000");
const hash = (code: string) => createHash("sha256").update(code).digest("hex");
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json")
    throw new HttpError(415, "JSON required");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new HttpError(413, "Request too large");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}
function readCode(value: unknown) {
  if (typeof value !== "string" || !CODE_PATTERN.test(value))
    throw new HttpError(400, "Invalid code");
  return value;
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const method = req.method;
    if (url.pathname === "/api/health" && method === "GET") {
      await prisma.$queryRaw`SELECT 1`;
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/api/vault" && method === "POST") {
      const input = await body(req);
      const tokenHash = hash(readCode(input.code));
      await prisma.vault.upsert({
        where: { tokenHash },
        create: { tokenHash },
        update: {},
      });
      return send(res, 201, { ok: true });
    }
    const code = req.headers.authorization?.match(
      /^Bearer ([a-f0-9]{64})$/,
    )?.[1];
    if (!code) throw new HttpError(401, "Invalid code");
    const input = method === "PUT" ? await body(req) : undefined;
    // Authorize inside the transaction so rotation cannot race a data write.
    const result = await prisma.$transaction(
      async (tx) => {
        const vault = await tx.vault.findUnique({
          where: { tokenHash: hash(code) },
        });
        if (!vault) throw new HttpError(401, "Invalid code");
        if (url.pathname === "/api/vault" && method === "GET")
          return { ok: true };
        if (url.pathname === "/api/vault/code" && method === "PUT") {
          await tx.vault.update({
            where: { id: vault.id },
            data: { tokenHash: hash(readCode(input?.code)) },
          });
          return { ok: true };
        }
        if (url.pathname === "/api/events" && method === "PUT") {
          const events = input?.events;
          if (
            !Array.isArray(events) ||
            events.length > BATCH_SIZE ||
            !events.every(isLogEvent)
          )
            throw new HttpError(400, "Invalid events");
          for (const event of events)
            await tx.event.upsert({
              where: { vaultId_id: { vaultId: vault.id, id: event.id } },
              create: { ...event, vaultId: vault.id },
              update: {},
            });
          return { ok: true };
        }
        if (url.pathname === "/api/events" && method === "GET") {
          const after = Number(url.searchParams.get("after") || 0);
          if (!Number.isSafeInteger(after) || after < 0)
            throw new HttpError(400, "Invalid cursor");
          const rows = await tx.event.findMany({
            where: { vaultId: vault.id, sequence: { gt: after } },
            orderBy: { sequence: "asc" },
            take: BATCH_SIZE + 1,
          });
          const page = rows.slice(0, BATCH_SIZE);
          return {
            events: page.map(
              ({ sequence: _sequence, vaultId: _vaultId, ...event }) => event,
            ),
            cursor: page.at(-1)?.sequence ?? after,
            more: rows.length > BATCH_SIZE,
          };
        }
        throw new HttpError(404, "Not found");
      },
      { timeout: 15000 },
    );
    send(res, 200, result);
  } catch (error) {
    if (error instanceof HttpError)
      send(res, error.status, { error: error.message });
    else {
      console.error(
        "API request failed",
        error instanceof Error ? error.name : "UnknownError",
      );
      send(res, 500, { error: "Server error" });
    }
  }
});
server.requestTimeout = 30000;
server.listen(
  Number(process.env.PORT || 3001),
  process.env.HOST || "0.0.0.0",
  () => console.log("Session log API ready"),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.close(() => {
      void prisma.$disconnect().then(() => process.exit(0));
    });
  });

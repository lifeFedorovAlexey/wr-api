import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const client = postgres(process.env.DATABASE_URL, {
  max: Number(process.env.DATABASE_POOL_MAX || 10),
});

export const db = drizzle(client);
export { client };

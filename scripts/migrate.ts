import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, closeDb } from "../src/server/db/client";

async function main() {
  await migrate(db(), { migrationsFolder: "./drizzle" });
  console.log("Migrações aplicadas.");
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});

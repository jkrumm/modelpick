import { seedModels } from "../src/db/seed.js";
import { client } from "../src/db/index.js";

await seedModels();
console.log("Seed complete.");
await client.end();

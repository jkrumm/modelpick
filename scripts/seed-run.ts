import { seedModels, seedStack } from "../src/db/seed.js";
import { client } from "../src/db/index.js";

await seedModels();
await seedStack();
console.log("Seed complete.");
await client.end();

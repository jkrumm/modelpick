import { seedModels, seedReplicateModels, seedStack } from "../src/db/seed.js";
import { client } from "../src/db/index.js";

await seedModels();
await seedReplicateModels();
await seedStack();
console.log("Seed complete.");
await client.end();

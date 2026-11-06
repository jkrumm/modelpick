import { seedDecisionModels, seedExternalModels, seedModels, seedReplicateModels } from "../src/db/seed.js";
import { client } from "../src/db/index.js";

await seedModels();
await seedReplicateModels();
await seedExternalModels();
await seedDecisionModels();
console.log("Seed complete.");
await client.end();

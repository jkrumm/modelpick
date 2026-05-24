import { collectNews } from "../src/server/collectors/news.js";
import { client } from "../src/db/index.js";

const result = await collectNews();
console.log(`[news] inserted: ${result.inserted}, skipped: ${result.skipped}`);
await client.end();

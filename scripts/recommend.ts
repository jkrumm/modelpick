import { runRecommender } from "../src/server/scoring/recommend.js";
import { client } from "../src/db/index.js";

const date = process.argv[2]; // optional yyyy-mm-dd override
await runRecommender(date);
await client.end();

import { createDatabase } from "./index";

const database = await createDatabase(process.env.DATABASE_URL);
await database.migrate();
await database.close();
console.log("migrations applied");

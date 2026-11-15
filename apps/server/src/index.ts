import { createServer } from "./app";

const server = createServer();
console.log(`server listening on ${server.url}`);

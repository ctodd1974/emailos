/**
 * TanStack Start entry — global request middleware.
 *
 * This file is auto-detected by the start plugin (resolved as `src/start.ts`);
 * exporting `startInstance` activates it. Wire the session guard so
 * unauthenticated /app/* HTML requests receive a real 302 to /login BEFORE
 * routing (dev and build runtimes both honour requestMiddleware).
 */
import { createStart } from "@tanstack/react-start";
import { sessionRequestMiddleware } from "./server/request-middleware.ts";

export const startInstance = createStart(() => ({
  requestMiddleware: [sessionRequestMiddleware],
}));
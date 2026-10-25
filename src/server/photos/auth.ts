import { ApiError } from "./contracts.js";
import type { Env } from "./env.js";
import { authenticateSession } from "../auth/session.js";

export interface Photographer { id: string }
export type Authenticate = (request: Request, env: Env) => Promise<Photographer>;

export const authenticatePhotographer: Authenticate = async (request, env) => {
  const session = await authenticateSession(request, env);
  if (session.role !== "photographer") throw new ApiError(401, "unauthenticated", "Sessão de fotógrafo necessária.");
  return { id: session.id };
};

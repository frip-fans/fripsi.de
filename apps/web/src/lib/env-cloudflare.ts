import { env } from "cloudflare:workers";
export function getRuntimeEnv(): Env { return env as Env; }

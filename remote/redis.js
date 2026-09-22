import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

redis.on("error", (err) => console.error("redis error:", err.message));

export async function saveTenant(token, tenant) {
  await redis.set(`tenant:${token}`, JSON.stringify(tenant));
}

export async function getTenant(token) {
  const raw = await redis.get(`tenant:${token}`);
  return raw ? JSON.parse(raw) : null;
}

export default redis;

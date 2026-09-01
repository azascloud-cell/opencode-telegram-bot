import crypto from "node:crypto";

const algorithm = "aes-256-gcm";

function keyFromSecret(secret) {
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

export function encryptState(value, secret) {
  if (!secret) throw new Error("STATE_ENCRYPTION_KEY is required for persistent state.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, keyFromSecret(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    version: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64")
  });
}

export function decryptState(serialized, secret) {
  if (!secret) throw new Error("STATE_ENCRYPTION_KEY is required for persistent state.");
  const envelope = JSON.parse(serialized);
  if (envelope?.version !== 1) throw new Error("Unsupported encrypted state version.");
  const decipher = crypto.createDecipheriv(
    algorithm,
    keyFromSecret(secret),
    Buffer.from(envelope.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final()
  ]).toString("utf8");
  return JSON.parse(plaintext);
}
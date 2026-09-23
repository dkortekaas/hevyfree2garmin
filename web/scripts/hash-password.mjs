#!/usr/bin/env node
// Print an argon2id hash for H2G_PASSWORD_HASH, so the plain password never has
// to sit in the deployment's environment. Usage:
//
//   npm run hash-password -- 'your password'
//
// lib/auth.ts verifies it with hash-wasm's argon2Verify.
import { argon2id } from "hash-wasm";
import { randomBytes } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error("Usage: npm run hash-password -- '<password>'");
  process.exit(1);
}

const hash = await argon2id({
  password,
  salt: randomBytes(16),
  parallelism: 1,
  iterations: 3,
  memorySize: 65536, // KiB
  hashLength: 32,
  outputType: "encoded",
});
console.log(hash);

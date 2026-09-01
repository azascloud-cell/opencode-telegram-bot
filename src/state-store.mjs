import fs from "node:fs/promises";
import path from "node:path";
import { decryptState, encryptState } from "./crypto-state.mjs";

const emptyState = () => ({ version: 1, users: {}, updatedAt: new Date().toISOString() });

export class StateStore {
  constructor({ stateFile, encryptionKey, github }) {
    this.stateFile = stateFile;
    this.encryptionKey = encryptionKey;
    this.github = github;
    this.cache = null;
  }

  async load() {
    if (this.cache) return this.cache;
    let serialized = null;
    if (this.github?.enabled) {
      serialized = (await this.github.readFile("data/state.enc"))?.content ?? null;
    } else {
      try {
        serialized = await fs.readFile(this.stateFile, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (!serialized) {
      this.cache = emptyState();
      return this.cache;
    }
    try {
      this.cache = decryptState(serialized, this.encryptionKey);
    } catch (error) {
      throw new Error(`Unable to decrypt persistent state: ${error.message}`);
    }
    return this.cache;
  }

  async save(state) {
    state.updatedAt = new Date().toISOString();
    const serialized = encryptState(state, this.encryptionKey);
    if (this.github?.enabled) {
      await this.github.writeFile("data/state.enc", serialized, "chore: persist encrypted bot state");
    } else {
      await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
      await fs.writeFile(this.stateFile, serialized, { mode: 0o600 });
    }
    this.cache = state;
  }
}
import { vi } from "bun:test";
import { config } from "./models.js";
export const spied = vi.mockObject(config, { spy: true });

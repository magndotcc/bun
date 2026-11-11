import { test, vi } from "bun:test";
import { spied } from "./helper.js";
test("the next file has it too", () => {
  spied.load.mockReturnValue("mocked by the next file");
  console.log("SAID in the next file", vi.isMockFunction(spied.load), spied.load(), spied.load.mock.calls.length);
});

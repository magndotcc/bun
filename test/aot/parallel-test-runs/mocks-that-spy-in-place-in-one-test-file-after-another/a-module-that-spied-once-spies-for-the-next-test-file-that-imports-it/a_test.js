import { test, vi } from "bun:test";
import { spied } from "./helper.js";
test("the first file has the spy of ./helper.js", () => {
  spied.load.mockReturnValue("mocked by the first file");
  console.log("SAID in the first file", vi.isMockFunction(spied.load), spied.load(), spied.load.mock.calls.length);
});

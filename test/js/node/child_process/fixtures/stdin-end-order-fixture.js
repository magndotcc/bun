// Prints what child.stdin does around end() and destroy(), one entry for each case.
// `node stdin-end-order-fixture.js` prints the report of Node.js.
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");

const echo = process.platform === "win32" ? [process.execPath, "-e", "process.stdin.pipe(process.stdout)"] : ["cat"];
const spawnEcho = () => spawn(echo[0], echo.slice(1), { stdio: ["pipe", "pipe", "inherit"] });
// Two turns of the loop past the child's 'close', so that an event that trails it is in the report.
const settled = child => new Promise(resolve => child.on("close", () => setImmediate(() => setImmediate(resolve))));

function logOf(child) {
  const log = [];
  for (const event of ["prefinish", "finish", "close"]) child.stdin.on(event, () => log.push(event));
  child.stdin.on("error", err => log.push(`error ${err.code}`));
  return log;
}
const callback = (log, name) => err => log.push(`${name} callback ${err ? err.code : null}`);

const uncaught = [];
process.on("uncaughtException", err => uncaught.push(err.message));

const cases = {
  async 'end("abc", cb)'() {
    const child = spawnEcho();
    const log = logOf(child);
    let read = "";
    child.stdout.setEncoding("utf8").on("data", chunk => (read += chunk));
    setImmediate(() => log.push("immediate"));
    child.stdin.end("abc", callback(log, "end"));
    await settled(child);
    return { log, read };
  },

  async 'end("abc", cb); destroy()'() {
    const child = spawnEcho();
    const log = logOf(child);
    child.stdout.resume();
    setImmediate(() => log.push("immediate"));
    child.stdin.end("abc", callback(log, "end"));
    child.stdin.destroy();
    await settled(child);
    return log;
  },

  async "destroy(err)"() {
    const child = spawnEcho();
    const log = logOf(child);
    child.stdout.resume();
    setImmediate(() => log.push("immediate"));
    child.stdin.destroy(Object.assign(new Error("boom"), { code: "BOOM" }));
    await settled(child);
    return log;
  },

  // Between end() and destroy() the stream still has its descriptor.
  async "an ended stdin as the stdout of another child"() {
    const first = spawnEcho();
    first.stdout.resume();
    const firstClosed = once(first, "close");
    const second = new Promise(resolve => {
      first.stdin.on("finish", () => {
        const args = process.platform === "win32" ? [process.execPath, "-e", ""] : ["true"];
        spawn(args[0], args.slice(1), { stdio: ["ignore", first.stdin, "inherit"] }).on("close", resolve);
      });
    });
    first.stdin.end("abc");
    return { second: await second, first: (await firstClosed)[0] };
  },
};

// On POSIX the reader gets end-of-file from end(), through shutdown(2). A listener of 'finish' that throws keeps the
// stream from its destroy().
if (process.platform !== "win32") {
  cases["a 'finish' listener that throws"] = async () => {
    const child = spawnEcho();
    let read = "";
    child.stdout.setEncoding("utf8").on("data", chunk => (read += chunk));
    child.stdin.on("finish", () => {
      throw new Error("from 'finish'");
    });
    child.stdin.end("abc");
    const [code] = await once(child, "close");
    return { read, code, uncaught };
  };
}

// end() from an immediate, while the exit of the child waits in the next poll: 'finish' comes first.
if (process.platform === "linux") {
  cases["end(cb) from an immediate, with the exit of the child due in the next poll"] = async () => {
    const child = spawn("cat", { stdio: ["pipe", "ignore", "inherit"] });
    const log = logOf(child);
    child.on("exit", () => log.push("exit"));
    await once(child, "spawn");
    await new Promise(resolve => setImmediate(resolve));
    process.kill(child.pid, "SIGKILL");
    // The child is a zombie until this process reaps it, and this loop has not polled since the kill.
    while (!/^\d+ \(.*\) Z /.test(fs.readFileSync(`/proc/${child.pid}/stat`, "utf8"))) {}
    setImmediate(() => log.push("immediate"));
    child.stdin.end(callback(log, "end"));
    await settled(child);
    return log;
  };
}

// Each case starts from a timer of its own: the cases log where the immediates of their turn come.
const report = {};
const pending = [];
for (const name in cases) {
  report[name] = undefined;
  pending.push(
    new Promise(resolve => setTimeout(() => resolve(cases[name]()), 1)).then(result => (report[name] = result)),
  );
}
Promise.all(pending).then(() => console.log(JSON.stringify(report, null, 2)));

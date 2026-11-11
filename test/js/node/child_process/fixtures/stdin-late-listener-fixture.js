// Prints which events of child.stdin reach listeners that are added after the call that causes them,
// later in the same turn of the event loop or one setImmediate later.
// `node stdin-late-listener-fixture.js` prints the report of Node.js.
const { spawn } = require("node:child_process");
const fs = require("node:fs");

const echo = process.platform === "win32" ? [process.execPath, "-e", "process.stdin.pipe(process.stdout)"] : ["cat"];

// What is called on child.stdin.
const calls = {
  'end("abc")': stdin => stdin.end("abc"),
  "end()": stdin => stdin.end(),
  "destroy()": stdin => stdin.destroy(),
  'end("abc"); destroy()': stdin => (stdin.end("abc"), stdin.destroy()),
};
// Where the call runs.
const from = {
  "the main script": run => run(),
  "a nextTick callback": run => process.nextTick(run),
  "the child's 'spawn' listener": (run, child) => child.once("spawn", run),
  "a promise job": run => Promise.resolve().then(run),
  "a timer": run => setTimeout(run, 1),
  "a setImmediate callback": run => setImmediate(run),
  "an fs callback": run => fs.stat(__filename, run),
  "a 'data' listener of the child's stdout": (run, child) => (child.stdout.once("data", run), child.stdin.write("x")),
};
// How much later the listeners are added.
const later = {
  "one tick": add => process.nextTick(add),
  "one promise job": add => Promise.resolve().then(add),
  "two promise jobs": add => Promise.resolve().then(() => Promise.resolve().then(add)),
  "a tick, then a promise job": add => process.nextTick(() => Promise.resolve().then(add)),
  "a promise job, then a tick": add => Promise.resolve().then(() => process.nextTick(add)),
  "one setImmediate": add => setImmediate(add),
};

function cell(call, start, wait) {
  return new Promise(resolve => {
    const child = spawn(echo[0], echo.slice(1), { stdio: ["pipe", "pipe", "inherit"] });
    const stdin = child.stdin;
    const heard = [];
    child.stdout.resume();
    start(() => {
      call(stdin);
      wait(() => {
        for (const event of ["finish", "close"]) stdin.on(event, () => heard.push(event));
      });
    }, child);
    // Two turns of the loop past the child's 'close', so that an event that trails it is in the report.
    child.on("close", () => setImmediate(() => setImmediate(() => resolve(heard.join(", ") || "nothing"))));
  });
}

// Every cell starts from the main script: in a promise job, the queued promise jobs run ahead of the nextTick queue.
const report = {};
const cells = [];
for (const what in calls) {
  report[what] = {};
  for (const where in from) {
    const row = (report[what][where] = {});
    for (const when in later) {
      row[when] = undefined;
      cells.push(cell(calls[what], from[where], later[when]).then(result => (row[when] = result)));
    }
  }
}
Promise.all(cells).then(() => console.log(JSON.stringify(report, null, 2)));

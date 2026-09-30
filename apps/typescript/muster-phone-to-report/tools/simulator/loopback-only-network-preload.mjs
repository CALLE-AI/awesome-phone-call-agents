import net from "node:net";

const originalConnect = net.connect.bind(net);
const originalCreateConnection = net.createConnection.bind(net);

function allowedHost(host) {
  return (
    host === undefined ||
    host === "localhost" ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    /^127(?:\.[0-9]{1,3}){3}$/u.test(host)
  );
}

function assertLoopback(args) {
  const first = args[0];
  if (typeof first === "string") return;
  if (typeof first === "number") {
    if (!allowedHost(typeof args[1] === "string" ? args[1] : undefined)) {
      throw new Error("Live demo readiness permits loopback networking only");
    }
    return;
  }
  if (first !== null && typeof first === "object") {
    if (typeof first.path === "string") return;
    if (!allowedHost(first.host)) {
      throw new Error("Live demo readiness permits loopback networking only");
    }
  }
}

net.connect = (...args) => {
  assertLoopback(args);
  return originalConnect(...args);
};
net.createConnection = (...args) => {
  assertLoopback(args);
  return originalCreateConnection(...args);
};

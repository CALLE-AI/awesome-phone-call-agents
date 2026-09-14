/* A listening port Chrome will actually fetch from.
 *
 * Chrome refuses a handful of ports whatever the host is, and answers ERR_UNSAFE_PORT
 * before the request leaves the browser. Asking the operating system for an ephemeral
 * port can land on one: a run here drew 1720, h323hostcall, and nineteen of twenty gates
 * recorded "could not measure" against a page that was serving perfectly well. The set
 * below is Chrome's own net::kRestrictedPorts. The fix is to hand the port back and ask
 * again, which costs nothing on the overwhelming majority of runs that never draw one.
 */
const UNSAFE_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 138, 139, 143,
  161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556,
  563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190,
  5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

export function listenSafely(server, tries = 20) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        if (!UNSAFE_PORTS.has(port)) {
          resolve({ server, port });
          return;
        }
        if (left <= 0) {
          reject(new Error(`only drew ports Chrome refuses, last was ${port}`));
          return;
        }
        server.close(() => attempt(left - 1));
      });
    };
    attempt(tries);
  });
}

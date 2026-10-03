// This app has no real authentication — `actor` is a caller-supplied string in the
// request body, trusted only because nothing but this same machine can ever reach it.
// Binding the server to 127.0.0.1 is the primary control (see server.js); this
// middleware is defense in depth for the case a proxy or a future change to that bind
// ever puts it on a real interface.

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLoopbackAddress(address) {
  return LOOPBACK_ADDRESSES.has(address);
}

function localOnlyMiddleware(req, res, next) {
  if (!isLoopbackAddress(req.socket && req.socket.remoteAddress)) {
    res.status(403).json({ error: 'This server only accepts local connections.' });
    return;
  }
  next();
}

module.exports = { isLoopbackAddress, localOnlyMiddleware };

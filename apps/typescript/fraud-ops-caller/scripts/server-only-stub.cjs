// ponytail: Node/tsx has no react-server export condition, so the real
// `server-only` package throws. Self-check and the capture script are already
// server-side; this empty module keeps that fence from breaking npm run check.
module.exports = {};

import dns from 'node:dns';

// Fix for Node.js 20+ undici/fetch ETIMEDOUT when IPv6 DNS records (e.g. NAT64) are unreachable
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}

const origLookup = dns.lookup;
dns.lookup = function (hostname, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    if (options && options.all) {
        return origLookup(hostname, options, (err, addresses) => {
            if (err) return callback(err);
            const ipv4Only = addresses.filter(a => a.family === 4);
            callback(null, ipv4Only.length ? ipv4Only : addresses);
        });
    }
    return origLookup(hostname, options, callback);
};

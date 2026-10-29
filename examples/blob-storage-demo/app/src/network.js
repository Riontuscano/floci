import { BlockList, isIPv4, isIPv6 } from 'node:net';

/**
 * Express middleware that only lets clients from the given CIDR ranges through.
 * Uses the TCP peer address, never X-Forwarded-For, so it cannot be spoofed by a header.
 * Loopback is always allowed so the container's own health check keeps working.
 */
export function allowNetworks(cidrs) {
  if (cidrs.length === 0) {
    return (req, res, next) => next();
  }

  const allowed = new BlockList();
  allowed.addSubnet('127.0.0.0', 8, 'ipv4');
  allowed.addAddress('::1', 'ipv6');
  for (const cidr of cidrs) {
    const [address, bits, extra] = cidr.split('/');
    const family = isIPv4(address) ? 'ipv4' : isIPv6(address) ? 'ipv6' : null;
    const maxBits = family === 'ipv4' ? 32 : 128;
    const prefix = bits === undefined ? maxBits : /^\d{1,3}$/.test(bits) ? Number(bits) : NaN;
    if (!family || extra !== undefined || !(prefix >= 0 && prefix <= maxBits)) {
      throw new Error(`Invalid entry in ALLOWED_NETWORKS: "${cidr}"`);
    }
    allowed.addSubnet(address, prefix, family);
  }
  console.log(`Access limited to: ${cidrs.join(', ')}`);

  return (req, res, next) => {
    const raw = req.socket.remoteAddress ?? '';
    const ip = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
    const family = isIPv4(ip) ? 'ipv4' : 'ipv6';
    if (allowed.check(ip, family)) {
      return next();
    }
    console.warn(`Blocked request from ${ip} to ${req.method} ${req.originalUrl}`);
    res.status(403).type('text/plain').send('Access denied: this service is only available on the office network.');
  };
}

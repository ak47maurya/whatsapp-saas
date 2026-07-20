import dns from 'dns';
const orig = dns.lookup;
dns.lookup = (hostname, opts, cb) => {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  if (hostname === 'cloudflare-dns.com') return orig(hostname, opts, cb);
  const doh = async () => {
    const res = await fetch('https://cloudflare-dns.com/dns-query?name=' + hostname + '&type=A', {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    const rec = data?.Answer?.find(a => a.type === 1);
    if (rec) return cb(null, rec.data, 4);
    cb(new Error('No record'));
  };
  doh().catch(cb);
};
console.time('lookup');
dns.lookup('web.whatsapp.com', (err, ip) => {
  console.timeEnd('lookup');
  console.log(err ? 'FAIL: ' + err.message : 'OK: ' + ip);
});

# Nginx configuration for correct client-IP / rate limiting

Production topology: **Client → Nginx → Node (Next.js)** on a DigitalOcean droplet.

The application rate-limits auth endpoints, OTP sends, the public Google-proxy
routes and the free-report / book-demo funnels **by client IP**
(`src/lib/rateLimit.ts` → `getClientIp()`). For that to be sound, two things
must be true about the deployment.

---

## 1. Nginx must forward the real client IP, and Node must trust only Nginx

`getClientIp()` resolves the IP in this order:

1. `X-Real-IP` — a single value Nginx sets from `$remote_addr` (the address
   Nginx received the TCP connection from). This is the preferred source
   because a client cannot append to or rewrite it through Nginx.
2. The **last** entry of `X-Forwarded-For`, minus `TRUSTED_PROXY_COUNT − 1`
   further hops. Nginx's `$proxy_add_x_forwarded_for` *appends* `$remote_addr`,
   so a client that sends `X-Forwarded-For: 1.2.3.4` only adds a bogus entry on
   the **left**; the real client is always on the right.
3. `'unknown'` — everyone shares one bucket (fails restrictive).

### Required `nginx.conf` (server / location block that proxies to Node)

```nginx
location / {
    proxy_pass         http://127.0.0.1:3000;   # Node bound to loopback — see §2
    proxy_http_version 1.1;

    # --- client IP: set BOTH, from the real connection address ---
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_set_header   X-Forwarded-Host  $host;
    proxy_set_header   Host              $host;

    # websockets / SSE (inbox live updates)
    proxy_set_header   Upgrade    $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_read_timeout 300s;
}
```

Do **not** use `proxy_set_header X-Forwarded-For $http_x_forwarded_for;` — that
forwards the client's header verbatim and lets anyone spoof their IP.

### Adding a CDN (e.g. Cloudflare) in front of Nginx

Two changes are then required:

1. Set `TRUSTED_PROXY_COUNT=2` in the app environment so `getClientIp()` skips
   both the CDN's and Nginx's hops when reading `X-Forwarded-For`.
2. Fix `X-Real-IP` — with a CDN, `$remote_addr` at Nginx is the CDN edge, not
   the visitor. Set it from the CDN's real-client header instead, e.g. for
   Cloudflare:
   ```nginx
   proxy_set_header X-Real-IP $http_cf_connecting_ip;
   ```
   (and restrict Nginx to accept connections only from Cloudflare's IP ranges).
   If you cannot, remove the `X-Real-IP` line entirely so the app falls back to
   the `X-Forwarded-For` last-`TRUSTED_PROXY_COUNT`-hops logic.

---

## 2. The Node port MUST NOT be publicly reachable

If a client can open a connection straight to Node on `:3000`, it becomes the
first hop — it can send any `X-Real-IP` / `X-Forwarded-For` it likes and there
is no trusted proxy to correct it, defeating every IP rate limit.

Pick one (loopback binding is simplest and strongest):

```bash
# Option A — bind Node to loopback only (recommended).
# In the process manager / systemd unit or ecosystem file:
HOSTNAME=127.0.0.1 PORT=3000 npm run start
#   (Next.js respects HOSTNAME/PORT; `next start -H 127.0.0.1 -p 3000` also works)

# Option B — firewall :3000 to localhost only.
sudo ufw deny 3000/tcp
sudo ufw allow 'Nginx Full'      # 80 + 443
sudo ufw status
```

Verify from another host that `http://<droplet-ip>:3000` **times out / refuses**,
while `https://<domain>` works.

---

## 3. Optional: an Nginx-level burst guard in front of the app

The in-process limiter in `src/lib/rateLimit.ts` is per-Node-instance. On the
current single-node droplet that is exactly right. An Nginx `limit_req` zone in
front of the auth routes is a cheap extra layer that also absorbs floods before
they reach Node at all:

```nginx
limit_req_zone $binary_remote_addr zone=auth:10m rate=20r/m;

location ~ ^/api/(auth|admin/auth|free-report|leads/book-demo|google)/ {
    limit_req  zone=auth burst=10 nodelay;
    proxy_pass http://127.0.0.1:3000;
    # ... same proxy_set_header block as §1 ...
}
```

If the app is ever moved to multiple Node instances behind a load balancer,
move the limiter store in `rateLimit.ts` to Redis/Upstash (the `checkRateLimit`
signature is designed to stay unchanged) **or** rely on the Nginx `limit_req`
layer above.

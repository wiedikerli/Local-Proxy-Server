# Local Proxy Server

Scripts to simplify the creation of nginx proxy for local dev server

## Quick Setup (Automated)

Run the setup script:

```bash
node setup.js
```

The script will:

-   Generate SSL certificates with mkcert (a single certificate covering all entered domains via SAN)
-   Update nginx configuration with your domain(s) and port
-   Optionally update hosts file (requires admin)
-   Starts docker instance

You can enter multiple domains, comma-separated, to proxy them all to the same port with one valid SSL certificate, e.g.:

```
www.example.ch, example.ch, api.example.ch
```

Each entered domain automatically gets its www/non-www variant included too.


## Cleanup

When you're done, run the cleanup script:

```bash
node cleanup.js
```

The script will:

-   Remove hosts file entries
-   Stop Docker Compose
-   Remove SSL certificates

## Manual Setup

1. `mkcert www.example.com example.com www.other.com other.com` and move the generated certificates into `nginx/ssl/` folder
2. add host entry to `C:\Windows\System32\drivers\etc\hosts` file

```hosts
127.0.0.1   www.example.com
127.0.0.1   example.com
127.0.0.1   www.other.com
127.0.0.1   other.com
```

3. edit `nginx/nginx.conf`
   3.1. update `server_name` with all domains
   3.2. update proxing port
   3.3. update ssl paths
4. Run `docker compose up`

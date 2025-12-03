# Local Proxy Server

Scripts to simplify the creation of nginx proxy for local dev server

## Quick Setup (Automated)

Run the setup script:

```bash
node setup.js
```

The script will:

-   Generate SSL certificates with mkcert
-   Update nginx configuration with your domain and port
-   Optionally update hosts file (requires admin)
-   Starts docker instance

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

1. `mkcert www.example.com` and move the generated certificates into `nginx/ssl/` folder
2. add host entry to `C:\Windows\System32\drivers\etc\hosts` file

```hosts
127.0.0.1   www.example.com
```

3. edit `nginx/nginx.conf`  
   3.1. update domain  
   3.2. update proxing port
   3.3. update ssl paths
4. Run `docker compose up`

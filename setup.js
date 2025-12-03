#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  console.log("🚀 Proxy Setup Script\n");

  // Step 1: Get domain name
  const domain = await question(
    "Enter your domain (e.g., www.smartseraina.ch): "
  );
  const domainWithoutWww = domain.replace(/^www\./, "");
  const domainWithWww = domain.startsWith("www.") ? domain : `www.${domain}`;

  // Step 2: Get proxy port
  const proxyPort = await question(
    "Enter the port to proxy to (e.g., 44314): "
  );

  console.log("\n📋 Configuration:");
  console.log(`   Domain (with www): ${domainWithWww}`);
  console.log(`   Domain (without www): ${domainWithoutWww}`);
  console.log(`   Proxy Port: ${proxyPort}\n`);

  const confirm = await question("Proceed with setup? (y/n): ");
  if (confirm.toLowerCase() !== "y") {
    console.log("Setup cancelled.");
    rl.close();
    return;
  }

  // Step 3: Generate SSL certificates with mkcert
  console.log("\n🔐 Generating SSL certificates...");
  try {
    execSync(
      `mkcert -cert-file ${domainWithWww}.pem -key-file ${domainWithWww}-key.pem ${domainWithWww} ${domainWithoutWww}`,
      { stdio: "inherit" }
    );

    // Move certificates to nginx/ssl folder
    const sslDir = path.join(__dirname, "nginx", "ssl");
    if (!fs.existsSync(sslDir)) {
      fs.mkdirSync(sslDir, { recursive: true });
    }

    const certFile = `${domainWithWww}.pem`;
    const keyFile = `${domainWithWww}-key.pem`;

    if (fs.existsSync(certFile)) {
      fs.renameSync(certFile, path.join(sslDir, certFile));
      console.log(`   ✓ Moved ${certFile} to nginx/ssl/`);
    }
    if (fs.existsSync(keyFile)) {
      fs.renameSync(keyFile, path.join(sslDir, keyFile));
      console.log(`   ✓ Moved ${keyFile} to nginx/ssl/`);
    }
  } catch (error) {
    console.error(
      "   ✗ Error generating certificates. Make sure mkcert is installed."
    );
    console.error("   Install mkcert: https://github.com/FiloSottile/mkcert");
  }

  // Step 4: Update nginx.conf
  console.log("\n⚙️  Updating nginx configuration...");
  const nginxConfPath = path.join(__dirname, "nginx", "nginx.conf");

  const nginxConf = `events {}

http {
    server {
        listen 443 ssl;
        server_name ${domainWithWww} ${domainWithoutWww};

        ssl_certificate     /etc/nginx/ssl/${domainWithWww}.pem;
        ssl_certificate_key /etc/nginx/ssl/${domainWithWww}-key.pem;

        location / {
            proxy_pass https://host.docker.internal:${proxyPort};
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }

    # Also allow HTTP → HTTPS redirect if needed
    server {
        listen 80;
        server_name ${domainWithWww} ${domainWithoutWww};
        return 301 https://$host$request_uri;
    }
}
`;

  fs.writeFileSync(nginxConfPath, nginxConf);
  console.log("   ✓ nginx.conf updated");

  // Step 5: Update hosts file
  console.log("\n📝 Updating hosts file...");
  const updateHosts = await question("Update hosts file automatically? (requires admin/sudo) (y/n): ");
  
  if (updateHosts.toLowerCase() === "y") {
    try {
      const hostsPath = process.platform === "win32" 
        ? "C:\\Windows\\System32\\drivers\\etc\\hosts"
        : "/etc/hosts";
      
      // Read current hosts file
      let hostsContent = fs.readFileSync(hostsPath, "utf8");
      
      // Check if entries already exist
      const wwwEntry = `127.0.0.1   ${domainWithWww}`;
      const nonWwwEntry = `127.0.0.1   ${domainWithoutWww}`;
      
      let needsUpdate = false;
      if (!hostsContent.includes(domainWithWww)) {
        hostsContent += `\n${wwwEntry}`;
        needsUpdate = true;
      }
      if (!hostsContent.includes(domainWithoutWww)) {
        hostsContent += `\n${nonWwwEntry}`;
        needsUpdate = true;
      }
      
      if (needsUpdate) {
        // Write back to hosts file
        if (process.platform === "win32") {
          // On Windows, write to temp file and use PowerShell with admin
          const tempFile = path.join(__dirname, "hosts.tmp");
          fs.writeFileSync(tempFile, hostsContent);
          execSync(`powershell -Command "Start-Process powershell -Verb RunAs -ArgumentList 'Copy-Item -Path ${tempFile} -Destination ${hostsPath} -Force'" -Wait`, { stdio: "inherit" });
          fs.unlinkSync(tempFile);
        } else {
          // On Unix-like systems, use sudo
          const tempFile = "/tmp/hosts.tmp";
          fs.writeFileSync(tempFile, hostsContent);
          execSync(`sudo cp ${tempFile} ${hostsPath}`, { stdio: "inherit" });
          fs.unlinkSync(tempFile);
        }
        console.log("   ✓ Hosts file updated");
      } else {
        console.log("   ✓ Hosts entries already exist");
      }
    } catch (error) {
      console.error("   ✗ Error updating hosts file. Please add manually:");
      console.log(`   127.0.0.1   ${domainWithWww}`);
      console.log(`   127.0.0.1   ${domainWithoutWww}`);
    }
  } else {
    console.log("   Skipped. Add these entries manually:");
    console.log("   Windows: C:\\Windows\\System32\\drivers\\etc\\hosts");
    console.log("   Mac/Linux: /etc/hosts\n");
    console.log(`   127.0.0.1   ${domainWithWww}`);
    console.log(`   127.0.0.1   ${domainWithoutWww}\n`);
  }

  // Step 6: Docker compose
  console.log("✅ Setup complete!\n");
  const startDocker = await question("Start Docker Compose now? (y/n): ");
  if (startDocker.toLowerCase() === "y") {
    console.log("\n🐳 Starting Docker Compose...\n");
    try {
      execSync("docker compose up", { stdio: "inherit" });
    } catch (error) {
      console.error("Error starting Docker Compose");
    }
  } else {
    console.log('\nRun "docker compose up" when ready to start the proxy.');
  }

  rl.close();
}

main().catch((error) => {
  console.error("Error:", error);
  rl.close();
  process.exit(1);
});

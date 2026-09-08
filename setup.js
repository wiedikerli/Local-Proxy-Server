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

function checkWindowsPortsBlocked(ports) {
	const blocked = [];
	for (const port of ports) {
		try {
			// netstat output contains lines like "  TCP  0.0.0.0:80  ..."
			const output = execSync(`netstat -an`, { encoding: "utf8" });
			// Also check excluded port ranges reserved by http.sys
			let reserved = "";
			try {
				reserved = execSync(
					`netsh int ipv4 show excludedportrange protocol=tcp`,
					{ encoding: "utf8" }
				);
			} catch (_) {}

			const portInUse = output.split("\n").some((line) => {
				const m = line.match(/TCP\s+[\d.:*]+:(\d+)\s/);
				return m ? m[1] === String(port) : false;
			});

			// Check if port falls within an http.sys excluded range
			let portReserved = false;
			if (reserved) {
				const rangeRegex = /(\d+)\s+(\d+)/g;
				let m;
				while ((m = rangeRegex.exec(reserved)) !== null) {
					const start = parseInt(m[1], 10);
					const num = parseInt(m[2], 10);
					if (port >= start && port < start + num) {
						portReserved = true;
						break;
					}
				}
			}

			if (portInUse || portReserved) blocked.push(port);
		} catch (_) {
			// If we can't check, assume it's fine
		}
	}
	return blocked;
}

async function main() {
	console.log("🚀 Proxy Setup Script\n");

	// Step 1: Get domain name(s)
	const domainsInput = await question(
		"Enter your domain(s), comma-separated (e.g., www.example.ch, example.ch, sub.example.ch): "
	);
	const rawDomains = domainsInput
		.split(",")
		.map((d) => d.trim())
		.filter(Boolean);

	// Expand each entered domain to its www/non-www pair, deduped, order preserved
	const allDomains = [];
	for (const raw of rawDomains) {
		const withoutWww = raw.replace(/^www\./, "");
		const withWww = raw.startsWith("www.") ? raw : `www.${raw}`;
		for (const variant of [withoutWww, withWww]) {
			if (!allDomains.includes(variant)) allDomains.push(variant);
		}
	}

	// Cert files are named after the first entered domain, but cover every domain via SAN
	const certBaseName = allDomains[0];

	// Step 2: Get proxy port
	const proxyPortInput = await question(
		"Enter the port to proxy to (default: 44314): "
	);
	const proxyPort = proxyPortInput.trim() || "44314";

	console.log("\n📋 Configuration:");
	console.log(`   Domains: ${allDomains.join(", ")}`);
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
			`mkcert -cert-file ${certBaseName}.pem -key-file ${certBaseName}-key.pem ${allDomains.join(
				" "
			)}`,
			{ stdio: "inherit" }
		);

		// Move certificates to nginx/ssl folder
		const sslDir = path.join(__dirname, "nginx", "ssl");
		if (!fs.existsSync(sslDir)) {
			fs.mkdirSync(sslDir, { recursive: true });
		}

		const certFile = `${certBaseName}.pem`;
		const keyFile = `${certBaseName}-key.pem`;

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
		console.error(
			"   Install mkcert: https://github.com/FiloSottile/mkcert"
		);
	}

	// Step 4: Update nginx.conf
	console.log("\n⚙️  Updating nginx configuration...");
	const nginxConfPath = path.join(__dirname, "nginx", "nginx.conf");
	const serverNames = allDomains.join(" ");

	const nginxConf = `events {}

http {
    server {
        listen 443 ssl;
        server_name ${serverNames};

        ssl_certificate     /etc/nginx/ssl/${certBaseName}.pem;
        ssl_certificate_key /etc/nginx/ssl/${certBaseName}-key.pem;

        location / {
            proxy_pass https://host.docker.internal:${proxyPort};
            proxy_ssl_server_name on;
            proxy_set_header Host localhost;
            proxy_set_header X-Forwarded-Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }

    # Also allow HTTP → HTTPS redirect if needed
    server {
        listen 80;
        server_name ${serverNames};
        return 301 https://$host$request_uri;
    }
}
`;

	fs.writeFileSync(nginxConfPath, nginxConf);
	console.log("   ✓ nginx.conf updated");

	// Step 5: Update hosts file
	console.log("\n📝 Updating hosts file...");
	const updateHosts = await question(
		"Update hosts file automatically? (requires admin/sudo) (y/n): "
	);

	if (updateHosts.toLowerCase() === "y") {
		try {
			const hostsPath =
				process.platform === "win32"
					? "C:\\Windows\\System32\\drivers\\etc\\hosts"
					: "/etc/hosts";

			// Read current hosts file
			let hostsContent = fs.readFileSync(hostsPath, "utf8");

			// Check if entries already exist
			let needsUpdate = false;
			for (const domainEntry of allDomains) {
				const entry = `127.0.0.1   ${domainEntry}`;
				if (!hostsContent.includes(entry)) {
					hostsContent += `\n${entry}`;
					needsUpdate = true;
				}
			}

			if (needsUpdate) {
				// Write back to hosts file
				if (process.platform === "win32") {
					// On Windows, write to temp file and use PowerShell with admin
					const tempFile = path.join(__dirname, "hosts.tmp");
					fs.writeFileSync(tempFile, hostsContent);
					execSync(
						`powershell -Command "Start-Process powershell -Verb RunAs -ArgumentList 'Copy-Item -Path ${tempFile} -Destination ${hostsPath} -Force'" -Wait`,
						{ stdio: "inherit" }
					);
					fs.unlinkSync(tempFile);
				} else {
					// On Unix-like systems, use sudo
					const tempFile = "/tmp/hosts.tmp";
					fs.writeFileSync(tempFile, hostsContent);
					execSync(`sudo cp ${tempFile} ${hostsPath}`, {
						stdio: "inherit",
					});
					fs.unlinkSync(tempFile);
				}
				console.log("   ✓ Hosts file updated");
			} else {
				console.log("   ✓ Hosts entries already exist");
			}
		} catch (error) {
			console.error(
				"   ✗ Error updating hosts file. Please add manually:"
			);
			for (const domainEntry of allDomains) {
				console.log(`   127.0.0.1   ${domainEntry}`);
			}
		}
	} else {
		console.log("   Skipped. Add these entries manually:");
		console.log("   Windows: C:\\Windows\\System32\\drivers\\etc\\hosts");
		console.log("   Mac/Linux: /etc/hosts\n");
		for (const domainEntry of allDomains) {
			console.log(`   127.0.0.1   ${domainEntry}`);
		}
		console.log();
	}

	// Step 6: Docker compose
	console.log("✅ Setup complete!\n");
	const startDocker = await question("Start Docker Compose now? (y/n): ");
	if (startDocker.toLowerCase() === "y") {
		// Check if required ports are available on Windows
		if (process.platform === "win32") {
			const portsBlocked = checkWindowsPortsBlocked([80, 443]);
			if (portsBlocked.length > 0) {
				console.log(
					`\n⚠️  Port(s) ${portsBlocked.join(", ")} are not available.`
				);
				console.log(
					"   On Windows, this is usually caused by the HTTP.sys service (IIS, Hyper-V, etc.)."
				);
				const freePorts = await question(
					"   Attempt to free port(s) automatically? (runs 'net stop http /y' as admin) (y/n): "
				);
				if (freePorts.toLowerCase() === "y") {
					try {
						execSync(
							`powershell -Command "Start-Process cmd -Verb RunAs -ArgumentList '/c net stop http /y' -Wait"`,
							{ stdio: "inherit" }
						);
						console.log("   ✓ HTTP.sys service stopped");
					} catch (error) {
						console.error(
							"   ✗ Could not stop HTTP.sys. Try running manually as admin:"
						);
						console.log("     net stop http /y");
						console.log('\nRun "docker compose up" when ready.');
						rl.close();
						return;
					}
				} else {
					console.log(
						"\n   To free port 80/443, run as Administrator:"
					);
					console.log("     net stop http /y");
					console.log('\nRun "docker compose up" when ready.');
					rl.close();
					return;
				}
			}
		}

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

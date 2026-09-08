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
	console.log("🧹 Proxy Cleanup Script\n");

	// Step 1: Get domain name(s)
	const domainsInput = await question(
		"Enter the domain(s) to remove, comma-separated (e.g., www.example.ch, example.ch): "
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

	console.log("\n📋 Will remove:");
	for (const domainEntry of allDomains) {
		console.log(`   - ${domainEntry}`);
	}

	const confirm = await question("\nProceed with cleanup? (y/n): ");
	if (confirm.toLowerCase() !== "y") {
		console.log("Cleanup cancelled.");
		rl.close();
		return;
	}

	// Step 2: Remove hosts file entries
	console.log("\n📝 Cleaning up hosts file...");
	const updateHosts = await question(
		"Remove hosts file entries? (requires admin/sudo) (y/n): "
	);

	if (updateHosts.toLowerCase() === "y") {
		try {
			const hostsPath =
				process.platform === "win32"
					? "C:\\Windows\\System32\\drivers\\etc\\hosts"
					: "/etc/hosts";

			// Read current hosts file
			let hostsContent = fs.readFileSync(hostsPath, "utf8");
			const originalContent = hostsContent;

			// Remove entries for all domains (match exact host entries)
			const entriesToRemove = allDomains.map(
				(domainEntry) => `127.0.0.1   ${domainEntry}`
			);
			const lines = hostsContent.split("\n");
			const filteredLines = lines.filter((line) => {
				const trimmedLine = line.trim();
				return !entriesToRemove.includes(trimmedLine);
			});

			hostsContent = filteredLines.join("\n");

			if (hostsContent !== originalContent) {
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
				console.log("   ✓ Hosts file entries removed");
			} else {
				console.log("   ✓ No matching entries found in hosts file");
			}
		} catch (error) {
			console.error(
				"   ✗ Error updating hosts file. Please remove manually:"
			);
			for (const domainEntry of allDomains) {
				console.log(`   Remove lines containing: ${domainEntry}`);
			}
		}
	} else {
		console.log("   Skipped. Remove these entries manually:");
		console.log("   Windows: C:\\Windows\\System32\\drivers\\etc\\hosts");
		console.log("   Mac/Linux: /etc/hosts\n");
		console.log(`   Lines containing: ${allDomains.join(", ")}`);
	}

	// Step 3: Ask about stopping Docker
	console.log("\n🐳 Docker Compose:");
	const stopDocker = await question("Stop Docker Compose? (y/n): ");
	if (stopDocker.toLowerCase() === "y") {
		try {
			execSync("docker compose down", { stdio: "inherit" });
			console.log("   ✓ Docker Compose stopped");
		} catch (error) {
			console.error("   ✗ Error stopping Docker Compose");
		}
	}

	// Step 4: Ask about removing SSL certificates
	console.log("\n🔐 SSL Certificates:");
	const removeCerts = await question(
		"Remove SSL certificates from nginx/ssl/? (y/n): "
	);
	if (removeCerts.toLowerCase() === "y") {
		try {
			const sslDir = path.join(__dirname, "nginx", "ssl");
			let certsFound = false;

			// Cert files are named after whichever domain was entered first at setup time,
			// so try every entered domain as a possible base name.
			for (const domainEntry of allDomains) {
				const certFile = path.join(sslDir, `${domainEntry}.pem`);
				const keyFile = path.join(sslDir, `${domainEntry}-key.pem`);

				if (fs.existsSync(certFile)) {
					fs.unlinkSync(certFile);
					console.log(`   ✓ Removed ${domainEntry}.pem`);
					certsFound = true;
				}
				if (fs.existsSync(keyFile)) {
					fs.unlinkSync(keyFile);
					console.log(`   ✓ Removed ${domainEntry}-key.pem`);
					certsFound = true;
				}
			}
			if (!certsFound) {
				console.log("   ✓ No certificates found");
			}
		} catch (error) {
			console.error("   ✗ Error removing certificates");
		}
	}

	console.log("\n✅ Cleanup complete!\n");
	rl.close();
}

main().catch((error) => {
	console.error("Error:", error);
	rl.close();
	process.exit(1);
});

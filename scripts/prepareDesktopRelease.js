const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputPath = path.join(root, 'apps', 'desktop', 'src-tauri', 'tauri.release.conf.json');
const checkOnly = process.argv.includes('--check');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} nije postavljen.`);
  return value;
}

function main() {
  const endpoint = required('TAURI_UPDATER_ENDPOINT');
  const publicKey = required('TAURI_UPDATER_PUBLIC_KEY');
  required('TAURI_SIGNING_PRIVATE_KEY');
  required('TAURI_SIGNING_PRIVATE_KEY_PASSWORD');

  const parsed = new URL(endpoint);
  if (parsed.protocol !== 'https:') throw new Error('TAURI_UPDATER_ENDPOINT mora koristiti HTTPS.');
  if (publicKey.length < 40) throw new Error('TAURI_UPDATER_PUBLIC_KEY ne izgleda kao ispravan javni ključ.');

  const requireWindowsSigning = process.env.DESKTOP_REQUIRE_WINDOWS_SIGNING !== 'false';
  const certificateThumbprint = String(process.env.WINDOWS_CERTIFICATE_THUMBPRINT || '').trim();
  if (requireWindowsSigning && !certificateThumbprint) {
    throw new Error('WINDOWS_CERTIFICATE_THUMBPRINT nije postavljen; release installer mora biti Authenticode potpisan.');
  }

  const config = {
    bundle: {
      createUpdaterArtifacts: true,
      windows: certificateThumbprint ? {
        certificateThumbprint,
        digestAlgorithm: 'sha256',
        timestampUrl: process.env.WINDOWS_TIMESTAMP_URL || 'http://timestamp.digicert.com',
      } : undefined,
    },
    plugins: {
      updater: {
        endpoints: [endpoint],
        pubkey: publicKey,
      },
    },
  };

  if (checkOnly) {
    console.log('Desktop release konfiguracija je spremna.');
    return;
  }
  fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  console.log(`Release konfiguracija je generisana: ${outputPath}`);
}

try {
  main();
} catch (error) {
  console.error(`[desktop-release] ${error.message}`);
  process.exit(1);
}

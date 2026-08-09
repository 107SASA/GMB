// Verification for Step 2 (Places API v1 category lookup).
// Run: npx tsx scripts/verify_step2.ts

import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1].trim() in process.env)) process.env[m[1].trim()] = v;
}

async function main() {
  const { GooglePlacesService } = await import('../src/services/google/places');

  const places = {
    'Desun Technology Private Limited': 'ChIJOaCUsBJxAjoRcfZNqb7fbMQ',
    'Desun Academy':                    'ChIJLUW07d91AjoRZCX-ZmBMGgE',
    'Desun Hospital':                   'ChIJhTIzuv9zAjoRcA2Ky8PBb-I',
  };

  for (const [name, placeId] of Object.entries(places)) {
    const details = await GooglePlacesService.getDetails(placeId);
    console.log(`\n${name} (${placeId})`);
    console.log(`  legacy types:        ${JSON.stringify(details?.categories)}`);
    console.log(`  primaryCategory:     ${details?.primaryCategory ?? '(undefined — falls back to "Local Business")'}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error('VERIFY FAILED:', e); process.exit(1); });

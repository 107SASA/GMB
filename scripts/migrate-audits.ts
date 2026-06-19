import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';

// Load environment variables manually
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf-8');
  envConfig.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      let val = match[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
      } else if (val.startsWith("'") && val.endsWith("'")) {
        val = val.slice(1, -1);
      }
      process.env[match[1]] = val;
    }
  });
}

const AuditSchema = new mongoose.Schema({
  tenantId: String,
  businessName: String,
  businessId: mongoose.Schema.Types.ObjectId,
  userDefinedCategory: String,
  googlePlaceId: String,
  website: String,
  phone: String,
  address: String,
  city: String,
  state: String,
  country: String,
  latitude: Number,
  longitude: Number,
  googleBusinessProfile: String,
}, { strict: false });

const BusinessSchema = new mongoose.Schema({
  name: String,
  organizationId: mongoose.Schema.Types.ObjectId,
  userDefinedCategory: String,
  googlePlaceId: String,
  website: String,
  phone: String,
  address: String,
  city: String,
  state: String,
  country: String,
  location: {
    type: { type: String },
    coordinates: [Number]
  }
}, { strict: false });

const Audit = mongoose.models.Audit || mongoose.model('Audit', AuditSchema);
const Business = mongoose.models.Business || mongoose.model('Business', BusinessSchema);

async function runMigration() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI as string);
    console.log('Connected.');

    const audits = await Audit.find({ businessId: { $exists: false } });
    console.log(`Found ${audits.length} audits to migrate.`);

    let migrated = 0;
    let failed = 0;

    for (const audit of audits) {
      // Find matching business by tenantId (organizationId) and name
      let business = null;
      if (mongoose.Types.ObjectId.isValid(audit.tenantId)) {
        business = await Business.findOne({
          organizationId: audit.tenantId,
          name: audit.businessName
        });
      }

      // Fallback: just try to match the name (for single-tenant or legacy data)
      if (!business) {
        business = await Business.findOne({ name: audit.businessName });
      }

      if (business) {
        audit.businessId = business._id;
        audit.userDefinedCategory = business.userDefinedCategory;
        audit.googlePlaceId = business.googlePlaceId;
        audit.website = business.website;
        audit.phone = business.phone;
        audit.address = business.address;
        audit.city = business.city;
        audit.state = business.state;
        audit.country = business.country;
        if (business.location?.coordinates?.length >= 2) {
          audit.longitude = business.location.coordinates[0];
          audit.latitude = business.location.coordinates[1];
        }
        audit.googleBusinessProfile = business.googlePlaceId 
          ? `https://search.google.com/local/writereview?placeid=${business.googlePlaceId}`
          : undefined;

        await audit.save();
        migrated++;
      } else {
        console.warn(`Could not find Business for Audit: ${audit._id} (${audit.businessName})`);
        failed++;
      }
    }

    console.log(`Migration complete. Migrated: ${migrated}, Failed: ${failed}`);
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigration();

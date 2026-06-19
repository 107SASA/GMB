import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
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

// Setup models locally to avoid next.js imports issues
const UserSchema = new mongoose.Schema({
  fullName: String,
  email: String,
  phone: String,
  passwordHash: String,
  role: String,
  isEmailVerified: Boolean,
  onboardingCompleted: Boolean,
  organizationId: mongoose.Schema.Types.ObjectId,
  activeBusinessId: mongoose.Schema.Types.ObjectId,
  businessIds: [mongoose.Schema.Types.ObjectId],
}, { timestamps: true });

const OrganizationSchema = new mongoose.Schema({
  name: String,
  ownerId: mongoose.Schema.Types.ObjectId,
}, { timestamps: true });

const BusinessSchema = new mongoose.Schema({
  name: String,
  userId: mongoose.Schema.Types.ObjectId,
  organizationId: mongoose.Schema.Types.ObjectId,
  category: String,
  address: String,
}, { timestamps: true });

const PlanSchema = new mongoose.Schema({
  name: String,
  price: Number,
}, { timestamps: true });

const SubscriptionSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  businessId: mongoose.Schema.Types.ObjectId,
  planId: mongoose.Schema.Types.ObjectId,
  planType: String,
  status: String,
  startDate: Date,
  endDate: Date,
}, { timestamps: true });

const User = mongoose.models.User || mongoose.model('User', UserSchema);
const Organization = mongoose.models.Organization || mongoose.model('Organization', OrganizationSchema);
const Business = mongoose.models.Business || mongoose.model('Business', BusinessSchema);
const Plan = mongoose.models.Plan || mongoose.model('Plan', PlanSchema);
const Subscription = mongoose.models.Subscription || mongoose.model('Subscription', SubscriptionSchema);

async function run() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI as string);
    console.log('Connected.');

    const email = 'admin@allplans.com';
    const password = 'Password123!';
    const passwordHash = await bcrypt.hash(password, 12);

    // Delete if exists
    await User.deleteOne({ email });

    console.log('Creating Organization...');
    const org = await Organization.create({
      name: 'All Plans Corp',
    });

    console.log('Creating User...');
    const user = await User.create({
      fullName: 'Super Admin',
      email,
      phone: '+12345678900',
      passwordHash,
      role: 'SUPER_ADMIN',
      isEmailVerified: true,
      onboardingCompleted: true,
      organizationId: org._id,
    });

    org.ownerId = user._id;
    await org.save();

    console.log('Creating Business...');
    const business = await Business.create({
      name: 'All Plans Business',
      userId: user._id,
      organizationId: org._id,
      category: 'Software Agency',
      address: '123 Tech Lane',
    });

    user.activeBusinessId = business._id;
    user.businessIds = [business._id];
    await user.save();

    console.log('Finding highest tier Plan...');
    let plan = await Plan.findOne({ name: 'Agency / Multi-Location' });
    if (!plan) {
       console.log('Plan not found, please run the migration script first.');
       process.exit(1);
    }

    console.log('Creating Subscription...');
    await Subscription.create({
      userId: user._id,
      businessId: business._id,
      planId: plan._id,
      planType: 'Enterprise', // Legacy support
      status: 'active',
      startDate: new Date(),
    });

    console.log('\n=======================================');
    console.log('ACCOUNT CREATED SUCCESSFULLY');
    console.log('=======================================');
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
    console.log(`Plan Access: ${plan.name} (Unlimited)`);
    console.log('=======================================\n');

    process.exit(0);
  } catch (error) {
    console.error('Failed:', error);
    process.exit(1);
  }
}

run();

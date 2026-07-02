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

// Setup models locally to avoid next.js imports issues
const PlanSchema = new mongoose.Schema({
  name: String,
  price: Number,
  billingCycle: String,
  maxPosts: Number,
  maxAudits: Number,
  maxBusinesses: Number,
  features: [String],
  active: Boolean
});

const SubscriptionSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  businessId: mongoose.Schema.Types.ObjectId,
  planId: mongoose.Schema.Types.ObjectId,
  planType: String,
  status: String,
  startDate: Date,
  endDate: Date,
});

const BusinessSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  name: String
});

const Plan = mongoose.models.Plan || mongoose.model('Plan', PlanSchema);
const Subscription = mongoose.models.Subscription || mongoose.model('Subscription', SubscriptionSchema);
const Business = mongoose.models.Business || mongoose.model('Business', BusinessSchema);

async function runMigration() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI as string);
    console.log('Connected.');

    // 1. Create Default Plans
    console.log('Creating default plans...');
    const plansToCreate = [
      {
        name: 'GBP Starter',
        price: 999,
        billingCycle: 'monthly',
        maxPosts: 7,
        maxAudits: 1,
        maxBusinesses: 1,
        features: ['1 Business Profile', 'Monthly Audit Report', '7 AI GBP Posts / Month', 'Review Monitoring', 'Basic SEO Recommendations', 'Competitor Overview', 'Audit History'],
        active: true
      },
      {
        name: 'Local Growth',
        price: 2499,
        billingCycle: 'monthly',
        maxPosts: 15,
        maxAudits: 4,
        maxBusinesses: 1,
        features: ['Everything in Starter', '15 AI Posts / Month', 'Weekly Audit Reports', 'Review Management', 'AI Review Replies', 'Local Competitor Tracking', 'Keyword Tracking', 'CRM', 'Lead Tracking'],
        active: true
      },
      {
        name: 'Lead Conversion Pro',
        price: 4999,
        billingCycle: 'monthly',
        maxPosts: 30,
        maxAudits: -1, // Unlimited
        maxBusinesses: 1,
        features: ['Everything in Growth', '30 AI Posts / Month', 'Unlimited Reviews', 'WhatsApp AI Agent', 'Automated Follow-ups', 'Lead Qualification', 'Conversion Tracking', 'Advanced Audit Intelligence', 'Priority Support'],
        active: true
      },
      {
        name: 'Agency / Multi-Location',
        price: 9999,
        billingCycle: 'monthly',
        maxPosts: -1, // Unlimited
        maxAudits: -1, // Unlimited
        maxBusinesses: -1, // Unlimited
        features: ['Everything in Pro', 'Multiple Businesses', 'Multi-Location Support', 'White Label Reports', 'Team Members', 'API Access', 'Advanced Analytics', 'Custom Branding', 'Dedicated Success Manager'],
        active: true
      }
    ];

    const createdPlans: Record<string, any> = {};
    for (const planData of plansToCreate) {
      let plan = await Plan.findOne({ name: planData.name });
      if (!plan) {
        plan = await Plan.create(planData);
      }
      createdPlans[planData.name] = plan;
    }

    const freePlanId = createdPlans['GBP Starter']._id;
    const proPlanId = createdPlans['Local Growth']._id;
    const enterprisePlanId = createdPlans['Agency / Multi-Location']._id;

    console.log('Plans created/verified.');

    // 2. Migrate Subscriptions
    console.log('Migrating subscriptions...');
    const subscriptions = await Subscription.find({});
    
    let updatedCount = 0;
    for (const sub of subscriptions) {
      let needsUpdate = false;
      
      // Map planType to planId
      if (!sub.planId && sub.planType) {
        if (sub.planType === 'Free') sub.planId = freePlanId;
        else if (sub.planType === 'Pro') sub.planId = proPlanId;
        else if (sub.planType === 'Enterprise') sub.planId = enterprisePlanId;
        needsUpdate = true;
      }
      
      // Map userId to businessId
      if (!sub.businessId && sub.userId) {
        // Find the first business for this user
        const business = await Business.findOne({ userId: sub.userId });
        if (business) {
          sub.businessId = business._id;
          needsUpdate = true;
        }
      }

      // Initialize dates if missing
      if (!sub.startDate) {
        sub.startDate = sub.createdAt || new Date();
        needsUpdate = true;
      }

      // Set status based on existing fields if not already set
      if (!sub.status) {
        sub.status = 'active'; // Default
        needsUpdate = true;
      }

      if (needsUpdate) {
        await sub.save();
        updatedCount++;
      }
    }

    console.log(`Migration complete. Updated ${updatedCount} subscriptions.`);
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigration();

import dbConnect from "@/lib/mongodb";
import Post from "@/models/Post";
import User from "@/models/User";
import Business from "@/models/Business";
import AutomationLog from "@/models/AutomationLog";
import { generatePost } from "./ai";

const MIN_SCHEDULED_POSTS = 7;

const generateNextDate = (baseDate: Date, daysAhead: number) => {
  const date = new Date(baseDate);
  date.setDate(date.getDate() + daysAhead);
  return date;
};

const createLog = async (action: string, status: string, message: string) => {
  try {
    await AutomationLog.create({
      action,
      status,
      message,
      type: 'scheduler'
    });
  } catch (err: any) {
    console.error("Log Error:", err.message);
  }
};

export const checkScheduledPosts = async () => {
  try {
    await dbConnect();
    console.log("Checking scheduled posts...");
    await createLog("SCHEDULER_START", "SUCCESS", "Scheduler started");

    const users = await User.find().populate("businessIds");
    const today = new Date();

    // Flatten users -> businesses into one list up front, then run a SINGLE
    // aggregated Post.find() for every business at once (grouped back out in
    // memory) instead of one Post.find() per business inside a per-user
    // loop — for N total businesses across all users this was previously N
    // sequential DB round-trips.
    const pairs: { user: any; business: any }[] = [];
    for (const user of users) {
      if (!user.businessIds || user.businessIds.length === 0) {
        await createLog("PROFILE_CHECK", "FAILED", `No business profile for ${user.email}`);
        continue;
      }
      for (const business of user.businessIds) pairs.push({ user, business });
    }

    const allBusinessIds = pairs.map((p) => p.business._id);
    const allFuturePosts = allBusinessIds.length > 0
      ? await Post.find({
          businessId: { $in: allBusinessIds },
          scheduledDate: { $gt: today },
          status: "scheduled",
        }).sort({ scheduledDate: 1 })
      : [];
    const futurePostsByBusiness = new Map<string, any[]>();
    for (const post of allFuturePosts) {
      const key = post.businessId.toString();
      const list = futurePostsByBusiness.get(key);
      if (list) list.push(post);
      else futurePostsByBusiness.set(key, [post]);
    }

    for (const { user, business } of pairs) {
      const futurePosts = futurePostsByBusiness.get(business._id.toString()) ?? [];

      console.log(`${user.email} (Business: ${business.name}) has ${futurePosts.length} scheduled posts`);

      if (futurePosts.length >= MIN_SCHEDULED_POSTS) {
        continue;
      }

      const missingPosts = MIN_SCHEDULED_POSTS - futurePosts.length;
      const lastScheduledDate = futurePosts.length > 0
        ? new Date(futurePosts[futurePosts.length - 1].scheduledDate || new Date())
        : new Date();

      // Each iteration's nextDate depends only on `i` and the pre-loop
      // lastScheduledDate, not on any other iteration's output — safe to
      // generate all missing posts' AI content concurrently instead of
      // paying up to MIN_SCHEDULED_POSTS (7) sequential AI-call latencies
      // per business. Promise.allSettled so one failure doesn't stop the
      // rest, matching the original per-post try/catch behavior.
      const results = await Promise.allSettled(
        Array.from({ length: missingPosts }, (_, idx) => idx + 1).map(async (i) => {
          const nextDate = generateNextDate(lastScheduledDate, i);
          const aiContent = await generatePost(business);
          return { nextDate, aiContent };
        })
      );

      for (const result of results) {
        if (result.status === "rejected") {
          console.error("Generation Error:", result.reason?.message ?? result.reason);
          await createLog("POST_GENERATION", "FAILED", result.reason?.message ?? String(result.reason));
          continue;
        }

        const { nextDate, aiContent } = result.value;
        if (!aiContent) {
          await createLog("AI_GENERATION", "FAILED", `AI returned empty content for ${business.name}`);
          continue;
        }

        try {
          await Post.create({
            title: `${business.name} Update`,
            content: aiContent,
            status: "scheduled",
            platform: "gmb",
            aiGenerated: true,
            scheduledDate: nextDate,
            generationPrompt: "Automated scheduler generation",
            businessId: business._id,
            userId: user._id
          });

          await createLog("POST_CREATED", "SUCCESS", `AI post created for ${business.name}`);
          console.log(`Post generated for ${business.name}`);
        } catch (err: any) {
          console.error("Generation Error:", err.message);
          await createLog("POST_GENERATION", "FAILED", err.message);
        }
      }
    }
    await createLog("SCHEDULER_COMPLETE", "SUCCESS", "Scheduler completed successfully");
  } catch (error: any) {
    console.error("Scheduler Error:", error.message);
    await createLog("SCHEDULER_FATAL", "FAILED", error.message);
  }
};

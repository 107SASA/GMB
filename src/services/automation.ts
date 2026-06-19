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

    for (const user of users) {
      if (!user.businessIds || user.businessIds.length === 0) {
        await createLog("PROFILE_CHECK", "FAILED", `No business profile for ${user.email}`);
        continue;
      }

      for (const business of user.businessIds) {
        const futurePosts = await Post.find({
          businessId: business._id,
          scheduledDate: { $gt: today },
          status: "scheduled"
        }).sort({ scheduledDate: 1 });

        console.log(`${user.email} (Business: ${business.name}) has ${futurePosts.length} scheduled posts`);

        if (futurePosts.length >= MIN_SCHEDULED_POSTS) {
          continue;
        }

        const missingPosts = MIN_SCHEDULED_POSTS - futurePosts.length;
        const lastScheduledDate = futurePosts.length > 0 
          ? new Date(futurePosts[futurePosts.length - 1].scheduledDate || new Date())
          : new Date();

        for (let i = 1; i <= missingPosts; i++) {
          try {
            const nextDate = generateNextDate(lastScheduledDate, i);
            const aiContent = await generatePost(business);

            if (!aiContent) {
              await createLog("AI_GENERATION", "FAILED", `AI returned empty content for ${business.name}`);
              continue;
            }

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
    }
    await createLog("SCHEDULER_COMPLETE", "SUCCESS", "Scheduler completed successfully");
  } catch (error: any) {
    console.error("Scheduler Error:", error.message);
    await createLog("SCHEDULER_FATAL", "FAILED", error.message);
  }
};

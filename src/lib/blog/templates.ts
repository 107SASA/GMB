/**
 * Post templates offered when a team member clicks "New post".
 *
 * Each one pre-fills a proven article structure (headings + short guidance in
 * grey brackets the writer replaces) and sensible design defaults, so a
 * non-technical writer starts from something that is already well-structured
 * for Google. "Custom" starts blank with every option open.
 */
import type { BlogTemplate, BlogLayout, BlogCtaType, BlogLanguage } from "@/models/BlogPost";

export interface TemplateDef {
  id: BlogTemplate;
  icon: string; // Material Symbols name
  name: string;
  nameHi: string;
  description: string;
  example: string;
  layout: BlogLayout;
  showToc: boolean;
  cta: BlogCtaType;
  body: Record<BlogLanguage, string>;
  faqs: Record<BlogLanguage, { question: string; answer: string }[]>;
}

const g = (t: string) => `<p><em>[${t}]</em></p>`;

export const BLOG_TEMPLATES: TemplateDef[] = [
  {
    id: "how_to",
    icon: "checklist",
    name: "How-to guide",
    nameHi: "स्टेप-बाय-स्टेप गाइड",
    description: "Teach one task step by step. Ranks well for “how to …” searches.",
    example: "How to get more Google reviews for your clinic",
    layout: "standard",
    showToc: true,
    cta: "free_report",
    body: {
      en: [
        g("Start with 2–3 sentences: what the reader will be able to do after reading, and why it matters for their business. Use your main keyword here."),
        "<h2>Why this matters</h2>",
        g("Explain the problem in simple words. Add one real number or example if you have it."),
        "<h2>What you need before you start</h2>",
        "<ul><li>[Item 1]</li><li>[Item 2]</li></ul>",
        "<h2>Step 1: [First step]</h2>",
        g("Explain the step. Add a screenshot if it helps."),
        "<h2>Step 2: [Second step]</h2>",
        g("Explain the step."),
        "<h2>Step 3: [Third step]</h2>",
        g("Explain the step."),
        "<h2>Common mistakes to avoid</h2>",
        "<ul><li>[Mistake 1]</li><li>[Mistake 2]</li></ul>",
        "<h2>Final thoughts</h2>",
        g("Sum up in 2–3 sentences and tell the reader what to do next. Link to our free report."),
      ].join(""),
      hi: [
        g("2–3 वाक्यों में बताएँ कि पढ़ने के बाद पाठक क्या कर पाएगा और यह उसके बिज़नेस के लिए क्यों ज़रूरी है।"),
        "<h2>यह क्यों ज़रूरी है</h2>",
        g("समस्या को आसान शब्दों में समझाएँ।"),
        "<h2>शुरू करने से पहले क्या चाहिए</h2>",
        "<ul><li>[पहली चीज़]</li><li>[दूसरी चीज़]</li></ul>",
        "<h2>स्टेप 1: [पहला स्टेप]</h2>",
        g("स्टेप समझाएँ।"),
        "<h2>स्टेप 2: [दूसरा स्टेप]</h2>",
        g("स्टेप समझाएँ।"),
        "<h2>स्टेप 3: [तीसरा स्टेप]</h2>",
        g("स्टेप समझाएँ।"),
        "<h2>इन गलतियों से बचें</h2>",
        "<ul><li>[गलती 1]</li><li>[गलती 2]</li></ul>",
        "<h2>निष्कर्ष</h2>",
        g("2–3 वाक्यों में सार लिखें और अगला कदम बताएँ।"),
      ].join(""),
    },
    faqs: {
      en: [{ question: "[A question people ask about this task]", answer: "[Short, direct answer]" }],
      hi: [{ question: "[इस विषय पर लोग क्या पूछते हैं]", answer: "[छोटा, सीधा जवाब]" }],
    },
  },
  {
    id: "listicle",
    icon: "format_list_numbered",
    name: "Tips list",
    nameHi: "टिप्स की सूची",
    description: "A numbered list of tips or ideas. Easy to read and share.",
    example: "10 ways restaurants can rank higher on Google Maps",
    layout: "standard",
    showToc: true,
    cta: "free_report",
    body: {
      en: [
        g("Intro: who these tips are for and what result they will get. Use your main keyword."),
        "<h2>1. [Tip one]</h2>",
        g("Explain the tip in 2–4 sentences. Say exactly what to do."),
        "<h2>2. [Tip two]</h2>",
        g("Explain the tip."),
        "<h2>3. [Tip three]</h2>",
        g("Explain the tip."),
        "<h2>4. [Tip four]</h2>",
        g("Explain the tip."),
        "<h2>5. [Tip five]</h2>",
        g("Explain the tip."),
        "<h2>Which tip should you start with?</h2>",
        g("Recommend the one easiest win and link to our free report to find more."),
      ].join(""),
      hi: [
        g("परिचय: ये टिप्स किसके लिए हैं और इनसे क्या फ़ायदा होगा।"),
        "<h2>1. [पहली टिप]</h2>",
        g("2–4 वाक्यों में समझाएँ।"),
        "<h2>2. [दूसरी टिप]</h2>",
        g("समझाएँ।"),
        "<h2>3. [तीसरी टिप]</h2>",
        g("समझाएँ।"),
        "<h2>4. [चौथी टिप]</h2>",
        g("समझाएँ।"),
        "<h2>5. [पाँचवीं टिप]</h2>",
        g("समझाएँ।"),
        "<h2>शुरुआत कहाँ से करें?</h2>",
        g("सबसे आसान टिप बताएँ और मुफ़्त रिपोर्ट का लिंक दें।"),
      ].join(""),
    },
    faqs: { en: [], hi: [] },
  },
  {
    id: "case_study",
    icon: "trending_up",
    name: "Customer success story",
    nameHi: "ग्राहक की सफलता की कहानी",
    description: "Show real results a business got. Builds trust with new customers.",
    example: "How a Pune dental clinic doubled its calls from Google",
    layout: "wide",
    showToc: false,
    cta: "book_demo",
    body: {
      en: [
        g("One-paragraph summary: who the business is, the result in one number, and how long it took."),
        "<h2>About the business</h2>",
        g("Type of business, city, how long they have been running."),
        "<h2>The challenge</h2>",
        g("What was not working before? Use the owner's own words if you can."),
        "<h2>What we did</h2>",
        "<ul><li>[Action 1]</li><li>[Action 2]</li><li>[Action 3]</li></ul>",
        "<h2>The results</h2>",
        "<table><tbody><tr><th>Measure</th><th>Before</th><th>After</th></tr><tr><td>[Google calls per month]</td><td>[ ]</td><td>[ ]</td></tr><tr><td>[Reviews]</td><td>[ ]</td><td>[ ]</td></tr></tbody></table>",
        "<blockquote><p>[A short quote from the owner]</p></blockquote>",
        "<h2>What you can learn from this</h2>",
        g("2–3 lessons any business owner can use."),
      ].join(""),
      hi: [
        g("एक पैराग्राफ़ में सार: बिज़नेस कौन है, नतीजा एक संख्या में, और कितना समय लगा।"),
        "<h2>बिज़नेस के बारे में</h2>",
        g("बिज़नेस का प्रकार, शहर, कब से चल रहा है।"),
        "<h2>चुनौती</h2>",
        g("पहले क्या ठीक नहीं चल रहा था?"),
        "<h2>हमने क्या किया</h2>",
        "<ul><li>[काम 1]</li><li>[काम 2]</li><li>[काम 3]</li></ul>",
        "<h2>नतीजे</h2>",
        "<table><tbody><tr><th>माप</th><th>पहले</th><th>बाद में</th></tr><tr><td>[हर महीने Google से कॉल]</td><td>[ ]</td><td>[ ]</td></tr><tr><td>[रिव्यू]</td><td>[ ]</td><td>[ ]</td></tr></tbody></table>",
        "<blockquote><p>[मालिक का छोटा सा कथन]</p></blockquote>",
        "<h2>इससे क्या सीखें</h2>",
        g("2–3 बातें जो कोई भी बिज़नेस मालिक अपना सकता है।"),
      ].join(""),
    },
    faqs: { en: [], hi: [] },
  },
  {
    id: "comparison",
    icon: "compare_arrows",
    name: "Comparison",
    nameHi: "तुलना",
    description: "Compare two options side by side and help the reader choose.",
    example: "Google Ads vs Google Business Profile: which brings more customers?",
    layout: "standard",
    showToc: true,
    cta: "book_demo",
    body: {
      en: [
        g("Intro: the two options and who this comparison is for."),
        "<h2>Quick comparison</h2>",
        "<table><tbody><tr><th></th><th>[Option A]</th><th>[Option B]</th></tr><tr><td>Cost</td><td>[ ]</td><td>[ ]</td></tr><tr><td>Time to see results</td><td>[ ]</td><td>[ ]</td></tr><tr><td>Best for</td><td>[ ]</td><td>[ ]</td></tr></tbody></table>",
        "<h2>[Option A]: pros and cons</h2>",
        "<ul><li>[Pro]</li><li>[Con]</li></ul>",
        "<h2>[Option B]: pros and cons</h2>",
        "<ul><li>[Pro]</li><li>[Con]</li></ul>",
        "<h2>Which one should you choose?</h2>",
        g("Give a clear recommendation for each type of business."),
      ].join(""),
      hi: [
        g("परिचय: दोनों विकल्प क्या हैं और यह तुलना किसके लिए है।"),
        "<h2>एक नज़र में तुलना</h2>",
        "<table><tbody><tr><th></th><th>[विकल्प A]</th><th>[विकल्प B]</th></tr><tr><td>खर्च</td><td>[ ]</td><td>[ ]</td></tr><tr><td>नतीजे कब तक</td><td>[ ]</td><td>[ ]</td></tr><tr><td>किसके लिए सही</td><td>[ ]</td><td>[ ]</td></tr></tbody></table>",
        "<h2>[विकल्प A]: फ़ायदे और नुकसान</h2>",
        "<ul><li>[फ़ायदा]</li><li>[नुकसान]</li></ul>",
        "<h2>[विकल्प B]: फ़ायदे और नुकसान</h2>",
        "<ul><li>[फ़ायदा]</li><li>[नुकसान]</li></ul>",
        "<h2>आपको कौन सा चुनना चाहिए?</h2>",
        g("हर तरह के बिज़नेस के लिए साफ़ सलाह दें।"),
      ].join(""),
    },
    faqs: {
      en: [{ question: "[Is option A or B cheaper?]", answer: "[Short answer]" }],
      hi: [{ question: "[कौन सा विकल्प सस्ता है?]", answer: "[छोटा जवाब]" }],
    },
  },
  {
    id: "local_guide",
    icon: "location_on",
    name: "City / industry guide",
    nameHi: "शहर / उद्योग गाइड",
    description: "Local SEO advice for one city or one type of business.",
    example: "Google Business Profile guide for gyms in Nashik",
    layout: "standard",
    showToc: true,
    cta: "free_report",
    body: {
      en: [
        g("Intro: name the city and/or business type in the first sentence. Say why Google matters for them."),
        "<h2>How customers in [city] search for [business type]</h2>",
        g("Common searches, e.g. “gym near me”, “best gym in [city]”."),
        "<h2>Set up your profile the right way</h2>",
        "<ul><li>[Category to choose]</li><li>[Photos to add]</li><li>[Services to list]</li></ul>",
        "<h2>Get more reviews</h2>",
        g("Practical ways to ask happy customers for reviews."),
        "<h2>Post regularly</h2>",
        g("Post ideas that work for this business type."),
        "<h2>Checklist</h2>",
        "<ul><li>[ ] [Task]</li><li>[ ] [Task]</li><li>[ ] [Task]</li></ul>",
      ].join(""),
      hi: [
        g("पहले वाक्य में शहर और/या बिज़नेस का प्रकार लिखें।"),
        "<h2>[शहर] में ग्राहक [बिज़नेस] को कैसे खोजते हैं</h2>",
        g("आम खोजें, जैसे “मेरे पास जिम”।"),
        "<h2>प्रोफ़ाइल सही तरीके से सेट करें</h2>",
        "<ul><li>[कौन सी कैटेगरी]</li><li>[कौन सी फ़ोटो]</li><li>[कौन सी सेवाएँ]</li></ul>",
        "<h2>ज़्यादा रिव्यू पाएँ</h2>",
        g("ख़ुश ग्राहकों से रिव्यू माँगने के आसान तरीके।"),
        "<h2>नियमित पोस्ट करें</h2>",
        g("इस बिज़नेस के लिए पोस्ट आइडिया।"),
        "<h2>चेकलिस्ट</h2>",
        "<ul><li>[ ] [काम]</li><li>[ ] [काम]</li><li>[ ] [काम]</li></ul>",
      ].join(""),
    },
    faqs: {
      en: [{ question: "[How long until my business shows up higher on Google Maps?]", answer: "[Short answer]" }],
      hi: [{ question: "[Google Maps पर ऊपर आने में कितना समय लगता है?]", answer: "[छोटा जवाब]" }],
    },
  },
  {
    id: "news",
    icon: "campaign",
    name: "News / update",
    nameHi: "खबर / अपडेट",
    description: "A Google change, a new feature, or company news. Short and timely.",
    example: "Google's new review rules: what local businesses must know",
    layout: "minimal",
    showToc: false,
    cta: "free_report",
    body: {
      en: [
        g("First paragraph: what changed, when, and who it affects. Answer it in 2–3 sentences."),
        "<h2>What changed</h2>",
        g("The details."),
        "<h2>What it means for your business</h2>",
        g("The practical impact."),
        "<h2>What to do now</h2>",
        "<ul><li>[Action 1]</li><li>[Action 2]</li></ul>",
      ].join(""),
      hi: [
        g("पहला पैराग्राफ़: क्या बदला, कब, और किस पर असर।"),
        "<h2>क्या बदला</h2>",
        g("पूरी जानकारी।"),
        "<h2>आपके बिज़नेस पर असर</h2>",
        g("व्यावहारिक असर।"),
        "<h2>अब क्या करें</h2>",
        "<ul><li>[काम 1]</li><li>[काम 2]</li></ul>",
      ].join(""),
    },
    faqs: { en: [], hi: [] },
  },
  {
    id: "custom",
    icon: "edit_note",
    name: "Custom (blank)",
    nameHi: "कस्टम (ख़ाली)",
    description: "Start from an empty page and choose every option yourself.",
    example: "Anything else",
    layout: "standard",
    showToc: true,
    cta: "free_report",
    body: { en: "", hi: "" },
    faqs: { en: [], hi: [] },
  },
];

export const getTemplate = (id: string) => BLOG_TEMPLATES.find((t) => t.id === id) || BLOG_TEMPLATES[BLOG_TEMPLATES.length - 1];

export const LAYOUT_OPTIONS: { id: BlogLayout; name: string; description: string; icon: string }[] = [
  { id: "standard", name: "Standard", description: "Cover image on top, contents list on the side. Best for guides.", icon: "article" },
  { id: "wide", name: "Wide hero", description: "Big full-width cover with the title over it. Best for stories.", icon: "panorama" },
  { id: "minimal", name: "Minimal", description: "No big cover, just the text. Best for short news.", icon: "notes" },
];

export const CTA_OPTIONS: { id: BlogCtaType; name: string; description: string }[] = [
  { id: "free_report", name: "Free report", description: "Invite readers to get their free Google profile report." },
  { id: "book_demo", name: "Book a demo", description: "Invite readers to book a free demo." },
  { id: "custom", name: "Custom", description: "Write your own heading, text and button link." },
  { id: "none", name: "No call-to-action", description: "Show nothing at the end of the post." },
];

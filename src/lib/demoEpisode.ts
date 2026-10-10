import type { Segment } from "@/types";

interface DemoSegment {
  start_s: number;
  end_s: number;
  text: string;
}

// ~12 min startup-founder interview with story / hot take / tip / stat / filler sections.
export const DEMO_SHOW = "A podcast about startups and AI tools";

const raw: DemoSegment[] = [
  { start_s: 0, end_s: 18, text: "Welcome back to the show. Today we've got Maya Chen, founder of Parallel, which just raised a Series A. Before we start, quick reminder to rate us five stars." },
  { start_s: 18, end_s: 34, text: "And a word from our sponsor, DevMail, the inbox for developers. Use code PODCAST for twenty percent off. Alright, Maya, welcome." },
  { start_s: 34, end_s: 52, text: "Thanks for having me. I've listened to this show since the beginning, so it's a little surreal to be on this side of the mic." },
  { start_s: 52, end_s: 74, text: "So tell us about Parallel. What are you building and who is it for?" },
  { start_s: 74, end_s: 98, text: "Parallel is a code review tool that reads your whole pull request and tells you what will actually break in production. Not style nits, real failures. We plug into GitHub and flag the two or three changes that matter out of the four hundred files you touched." },
  { start_s: 98, end_s: 120, text: "We started it because at my last company we shipped a change on a Friday that took down payments for six hours. Everyone had reviewed the PR. Four approvals. Nobody caught it." },
  { start_s: 120, end_s: 142, text: "Honestly, the biggest mistake I made was hiring a VP of Sales before we had ten paying customers. We burned eight months and almost died." },
  { start_s: 142, end_s: 166, text: "Wait, eight months? Walk me through that, because half our audience is pre-product-market-fit and they're being pitched by sales leaders every week." },
  { start_s: 166, end_s: 192, text: "Yeah, so this guy had a great resume, enterprise background, and he told me exactly what I wanted to hear. We'll build a pipeline, we'll get logos. And for eight months we got nothing but pipeline. Demos, pilots, proof of concepts. Never a check." },
  { start_s: 192, end_s: 214, text: "The problem wasn't him. The problem was that our product wasn't ready to be sold by anyone. I hired sales to fix a product problem, and that's never how it works." },
  { start_s: 214, end_s: 238, text: "What finally turned it around?" },
  { start_s: 238, end_s: 264, text: "I fired him, which was brutal because he was a good guy, and I went back to founder-led sales. Me, cold DMs, and a demo. We closed our first five customers in six weeks doing the thing I'd been paying someone else to fail at." },
  { start_s: 264, end_s: 288, text: "So my advice is blunt: if you can't sell it yourself, nobody you hire can either. Hire sales to multiply demand you already have, never to create it." },
  { start_s: 288, end_s: 310, text: "That's a rule I wish was on a poster somewhere. Okay, let's talk about the AI side of Parallel, because that's what everyone asks about." },
  { start_s: 310, end_s: 334, text: "Everyone wants to slap AI on everything right now. My hot take: ninety percent of AI features being shipped today are a distraction. They're demos dressed up as products." },
  { start_s: 334, end_s: 358, text: "If your AI feature doesn't save someone a measurable hour of their week, it's a toy. Users will try it once, post a screenshot, and never touch it again. We killed four AI features last year that fit that description." },
  { start_s: 358, end_s: 380, text: "Which ones did you kill?" },
  { start_s: 380, end_s: 404, text: "A release-notes generator, a standup summarizer, an AI changelog, and something we called Smart Assignment. All of them demoed beautifully. None of them changed a single metric." },
  { start_s: 404, end_s: 428, text: "The one that stuck, predicting production failures, saves senior engineers about three hours a week. That's why it's the product. One feature that saves real time beats five that look good in a launch tweet." },
  { start_s: 428, end_s: 452, text: "I want to push back a little. Doesn't the market punish you for not having the shiny features? Buyers do ask for them." },
  { start_s: 452, end_s: 476, text: "Buyers ask for them, but they don't renew because of them. Look at our churn: it's under two percent monthly, and I can tell you zero of our renewals cite the release notes generator. Renewals cite the failure predictions, full stop." },
  { start_s: 476, end_s: 500, text: "Speaking of numbers, you published some interesting stats in your last fundraise deck. What surprised you?" },
  { start_s: 500, end_s: 526, text: "The stat that shocked me: teams using Parallel shipped forty-one percent fewer rollback events, but their PR cycle time went up nine percent. People were slower and happier." },
  { start_s: 526, end_s: 550, text: "Slower and happier is such a good way to put it. I think every engineering leader listening knows the feeling of fast and terrified." },
  { start_s: 550, end_s: 574, text: "Right, fast and terrified is the default state of most teams. And the nine percent slowdown was concentrated in the riskiest changes. The safe changes actually got merged faster because reviewers stopped sweating every line." },
  { start_s: 574, end_s: 598, text: "Let's do a quick tactical section. If someone is starting an AI product today, what should they build first?" },
  { start_s: 598, end_s: 622, text: "Build the boring pipeline first. Everyone wants to build the model wrapper and the chat UI. The actual moat is the data plumbing: getting the customer's messy real-world data in, cleaning it, and evaluating your outputs honestly." },
  { start_s: 622, end_s: 646, text: "Concretely: write an eval set of fifty real cases before you write the feature. If you can't measure it, you're shipping vibes. We had our eval set before we had a landing page." },
  { start_s: 646, end_s: 670, text: "That is such practical advice. Fifty real cases, measure before you build. Okay, rapid fire round. Overrated or underrated: fine-tuning?" },
  { start_s: 670, end_s: 692, text: "Overrated for most teams, underrated for a niche. If your task is classification with fixed labels, fine-tune. If it's open-ended reasoning, you're wasting your money." },
  { start_s: 692, end_s: 714, text: "Agents?" },
  { start_s: 714, end_s: 740, text: "Underrated long term, overrated right now. Everyone's demos break on step four. The teams that win will be the ones that made the agent boring and reliable, not the ones with the flashiest Twitter video." },
  { start_s: 740, end_s: 762, text: "Okay, last one: founder mode versus manager mode?" },
  { start_s: 762, end_s: 788, text: "Founder mode, but only because most managers are managing the wrong metrics. Managing activity instead of outcomes. Give me a manager who tracks outcomes and I'll take manager mode all day." },
  { start_s: 788, end_s: 812, text: "Before we wrap, what's next for Parallel?" },
  { start_s: 812, end_s: 838, text: "We're opening up the failure prediction API so other tools can build on it, and we're doubling down on the eval infrastructure, because honestly that's what nobody else is building well." },
  { start_s: 838, end_s: 860, text: "And finally, where can people find you?" },
  { start_s: 860, end_s: 884, text: "Maya at parallel dot dev, or on X. And if you try Parallel and it saves you from a Friday deploy disaster, that story makes my week." },
  { start_s: 884, end_s: 910, text: "Amazing. Thanks so much, Maya. And thanks everyone for listening. If you got value from this episode, the best thing you can do is share it with one founder who needs to hear the sales advice. See you next week." },
];

// Deterministic pseudo-waveform peaks (~1200 buckets) shaped like a real episode.
function buildPeaks(count = 1200): number[] {
  const peaks: number[] = [];
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < count; i++) {
    const t = (i / count) * raw[raw.length - 1].end_s;
    // quieter during intro/sponsor (0-34s), louder in stories, dips near section breaks
    let base = 0.55;
    if (t < 34) base = 0.3;
    if (t > 120 && t < 290) base = 0.75;
    if (t > 598 && t < 670) base = 0.65;
    const env = 0.7 + 0.3 * Math.sin(t / 23);
    peaks.push(Math.min(1, base * env * (0.75 + 0.5 * rand())));
  }
  return peaks;
}

export const DEMO_PEAKS = buildPeaks();

export const DEMO_SEGMENTS: Pick<Segment, "idx" | "start_s" | "end_s" | "text">[] = raw.map(
  (s, i) => ({ idx: i, start_s: s.start_s, end_s: s.end_s, text: s.text }),
);

export const DEMO_DURATION_S = raw[raw.length - 1].end_s;

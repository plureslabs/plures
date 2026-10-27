// A Vercel AI SDK tool that sends a judgment call to ID verified people.
//   npm install ai zod plures
//   PLURES_API_KEY=pk_test_...
import { tool } from "ai";
import { z } from "zod";
import { Plures } from "plures";

const plures = new Plures(); // reads PLURES_API_KEY

export const askHumans = tool({
  description:
    "Ask ID verified people to decide a judgment call before acting on it, such as a customer's tone, " +
    "a refund, or whether two documents match. Returns their answer and how strongly they agreed.",
  inputSchema: z.object({
    question: z.string().describe("What people should decide, answerable from the context alone"),
    options: z.array(z.string()).min(2).max(8),
    context: z.string().describe("The material to judge, as plain text"),
  }),
  execute: async ({ question, options, context }) => {
    const task = await plures.verify({ question, options, context, verifiers: 3 }, { timeoutMs: 5 * 60_000 });
    const r = task.result;
    return {
      status: task.status,
      answer: r?.label ?? null,
      agreement: r?.agreement ?? 0,
      guidance: r?.answer != null && r.agreement >= 1 ? "Unanimous: safe to act on." : "Not unanimous: escalate to a person.",
    };
  },
});

// Use it like any other tool:
//   const { text } = await generateText({ model, tools: { askHumans }, stopWhen: stepCountIs(5), prompt });

"""Give an OpenAI Agents SDK agent a tool to ask ID verified people before it acts.

    pip install openai-agents plures
    OPENAI_API_KEY=... PLURES_API_KEY=pk_test_... python refund_agent.py
"""
from typing import List

from agents import Agent, Runner, function_tool
from plures import Plures

plures = Plures()  # reads PLURES_API_KEY


@function_tool
def ask_verified_humans(question: str, options: List[str], context: str) -> str:
    """Ask ID verified people to decide a judgment call before acting on it.

    Use it when a wrong call costs money or trust: tone and intent, refunds,
    whether two things match. Returns their answer and how strongly they agreed.

    Args:
        question: What people should decide, answerable from the context alone.
        options: Two to eight possible answers.
        context: The material to judge, as plain text.
    """
    task = plures.verify(question, options, context=context, verifiers=3, timeout=300)
    r = task.get("result") or {}
    if task["status"] != "completed" or r.get("answer") is None:
        return "No clear answer from verified people (status %s). Escalate to the team." % task["status"]
    return "Verified people answered %s, agreement %.0f%%. %s" % (
        r["label"], r["agreement"] * 100,
        "Safe to act on." if r["agreement"] >= 1 else "Not unanimous: escalate instead of acting.",
    )


agent = Agent(
    name="Refunds",
    instructions=(
        "You handle refund requests. Before approving or declining any refund, "
        "use ask_verified_humans to check the customer's situation, and follow their answer."
    ),
    tools=[ask_verified_humans],
)

if __name__ == "__main__":
    result = Runner.run_sync(agent, "Customer: my order arrived broken, I want my $64 back. Order delivered 3 days ago.")
    print(result.final_output)

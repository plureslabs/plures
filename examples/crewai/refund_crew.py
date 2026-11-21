"""Give a CrewAI agent a tool to ask ID verified people before it acts.

    pip install crewai plures
    OPENAI_API_KEY=... PLURES_API_KEY=pk_test_... python refund_crew.py

A pk_test_ key is free and answers instantly without real people.
"""
from crewai import Agent, Crew, Task
from crewai.tools import tool
from plures import Plures

plures = Plures()  # reads PLURES_API_KEY


@tool("Ask verified humans")
def ask_verified_humans(question: str, options: list[str], context: str) -> str:
    """Ask ID verified people to decide a judgment call before acting on it.
    Use it for refunds, a customer's tone or intent, or whether two documents match.
    question: what people should decide, answerable from the context alone.
    options: two to eight possible answers. context: the material to judge."""
    task = plures.verify(question, options, context=context, verifiers=3, timeout=300)
    r = task.get("result") or {}
    if task["status"] != "completed" or r.get("answer") is None:
        return "No clear answer from verified people. Escalate to the team."
    verdict = "Safe to act on." if r["agreement"] >= 1 else "Not unanimous: escalate instead of acting."
    return f"Verified people answered {r['label']} (agreement {r['agreement']:.0%}). {verdict}"


support = Agent(
    role="Refund specialist",
    goal="Resolve refund requests fairly",
    backstory="You never approve or decline a refund without asking verified humans first.",
    tools=[ask_verified_humans],
)

ticket = Task(
    description="Customer: 'The cake showed up a day late and smashed. Amazing service, really.' Order: $64.",
    expected_output="The refund decision and a short reply to the customer.",
    agent=support,
)

if __name__ == "__main__":
    print(Crew(agents=[support], tasks=[ticket]).kickoff())

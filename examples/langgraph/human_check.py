"""Human in the loop for LangGraph with Plures.

A refund agent drafts a decision, sends the judgment call to ID verified people,
and only acts automatically when they all agree. Anything less goes to your team.

    pip install langgraph plures
    PLURES_API_KEY=pk_test_... python human_check.py

A pk_test_ key is free and answers instantly without real people.
"""
from typing import Optional, TypedDict

from langgraph.graph import END, START, StateGraph
from plures import Plures

plures = Plures()  # reads PLURES_API_KEY


class State(TypedDict):
    message: str
    order_total: float
    answer: Optional[str]
    agreement: float
    outcome: str


def ask_humans(state: State) -> dict:
    task = plures.verify(
        "Should this customer get a full refund?",
        ["Yes", "No"],
        context="Order total: $%.2f\nCustomer: %s" % (state["order_total"], state["message"]),
        verifiers=3,
        timeout=600,
    )
    result = task.get("result") or {}
    return {"answer": result.get("answer"), "agreement": result.get("agreement", 0)}


def route(state: State) -> str:
    if state["agreement"] >= 1:
        return "refund" if state["answer"] == "Yes" else "decline"
    return "escalate"


graph = StateGraph(State)
graph.add_node("ask_humans", ask_humans)
graph.add_node("refund", lambda s: {"outcome": "Refunded $%.2f" % s["order_total"]})
graph.add_node("decline", lambda s: {"outcome": "Declined, with a note to the customer"})
graph.add_node("escalate", lambda s: {"outcome": "Sent to the support team: verifiers didn't fully agree"})
graph.add_edge(START, "ask_humans")
graph.add_conditional_edges("ask_humans", route, ["refund", "decline", "escalate"])
for node in ("refund", "decline", "escalate"):
    graph.add_edge(node, END)
app = graph.compile()

if __name__ == "__main__":
    out = app.invoke({
        "message": "The cake showed up a day late and smashed. Amazing service, really.",
        "order_total": 64.0, "answer": None, "agreement": 0.0, "outcome": "",
    })
    print(out["outcome"])

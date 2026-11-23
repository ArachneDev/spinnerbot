"""The logic behind /roll. An example of a Python command."""

import random


def run(data):
    sides = data["sides"]  # Required, so always present.
    count = data.get("count", 1)  # Optional, so missing if the user left it out.
    rolls = [random.randint(1, sides) for _ in range(count)]
    return {"rolls": rolls, "total": sum(rolls)}

from commands.roll import run


def test_rolls_the_requested_dice():
    result = run({"sides": 6, "count": 3})
    assert len(result["rolls"]) == 3
    assert all(1 <= roll <= 6 for roll in result["rolls"])
    assert result["total"] == sum(result["rolls"])


def test_count_is_optional():
    assert len(run({"sides": 6})["rolls"]) == 1

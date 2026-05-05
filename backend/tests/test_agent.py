from backend.agent import BrowsingAgent


def test_validate_action_allows_valid_click():
    agent = BrowsingAgent()

    action = {"action": "click", "x": 100, "y": 200}
    validated = agent.validate_action(action)

    assert validated["action"] == "click"
    assert validated["x"] == 100
    assert validated["y"] == 200


def test_validate_action_rejects_invalid_action():
    agent = BrowsingAgent()

    action = {"action": "hack_the_mainframe"}
    validated = agent.validate_action(action)

    assert validated["action"] == "wait"


def test_validate_action_blocks_negative_click():
    agent = BrowsingAgent()

    action = {"action": "click", "x": -10, "y": 100}
    validated = agent.validate_action(action)

    assert validated["action"] == "wait"


def test_validate_action_blocks_out_of_bounds_click():
    agent = BrowsingAgent()

    action = {"action": "click", "x": 99999, "y": 99999}
    validated = agent.validate_action(action)

    assert validated["action"] == "wait"


def test_validate_action_blocks_empty_type():
    agent = BrowsingAgent()

    action = {"action": "type", "text": "   "}
    validated = agent.validate_action(action)

    assert validated["action"] == "wait"


def test_validate_action_truncates_long_text():
    agent = BrowsingAgent()

    long_text = "a" * 2000
    action = {"action": "type", "text": long_text}

    validated = agent.validate_action(action)

    assert validated["action"] == "type"
    assert len(validated["text"]) <= 500


def test_validate_action_blocks_bad_url_scheme():
    agent = BrowsingAgent()

    action = {"action": "navigate", "url": "javascript:alert(1)"}
    validated = agent.validate_action(action)

    assert validated["action"] == "wait"
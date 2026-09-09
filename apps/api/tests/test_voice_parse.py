"""Phase 2 voice/parse tests: rule-based Bengali transcript parsing."""

from datetime import UTC, datetime

from helpers import register_user
from httpx import AsyncClient

VOICE = "/api/v1/voice/parse"


async def test_parse_two_items_bengali(client: AsyncClient) -> None:
    headers, _ = await register_user(client, email="voice1@test.dev")
    r = await client.post(
        VOICE, json={"text": "চা ৫০ এবং রিকশা ৪০"}, headers=headers
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"items", "confidence"}
    items = body["items"]
    assert len(items) == 2
    first, second = items
    assert first["cat"] == "চা"
    assert first["grp"] == "food"
    assert first["amt"] == "50.00"
    assert second["cat"] == "রিকশা"
    assert second["grp"] == "transport"
    assert second["amt"] == "40.00"
    assert body["confidence"] == 0.95
    today = datetime.now(UTC).date().isoformat()
    assert all(i["iso"] == today for i in items)


async def test_parse_english_keyword_decimal(client: AsyncClient) -> None:
    headers, _ = await register_user(client, email="voice2@test.dev")
    r = await client.post(VOICE, json={"text": "coffee 120.50"}, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["items"]) == 1
    item = body["items"][0]
    assert item["grp"] == "food"
    assert item["amt"] == "120.50"
    assert body["confidence"] == 0.95


async def test_parse_longest_keyword_beats_substring(client: AsyncClient) -> None:
    """Owner report: 'চাল ৫০ টাকা' parsed as খাত 'চা' — longest match must win."""
    headers, _ = await register_user(client, email="voice3@test.dev")
    r = await client.post(
        VOICE, json={"text": "চাল ৫০ টাকা"}, headers=headers
    )
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["cat"] == "চাল"  # not the substring "চা"
    assert items[0]["grp"] == "food"
    assert items[0]["amt"] == "50.00"


async def test_parse_tea_still_tea_and_groceries(client: AsyncClient) -> None:
    headers, _ = await register_user(client, email="voice4@test.dev")
    r = await client.post(
        VOICE,
        json={"text": "চা ২০, ডাল ১১০ এবং বাজার ৩০০"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [i["cat"] for i in items] == ["চা", "ডাল", "বাজার"]
    assert all(i["grp"] == "food" for i in items)


async def test_parser_learns_khata_from_history(client: AsyncClient) -> None:
    """Zero-AI learning loop: a saved khata is recognised on the next parse.

    Owner asked for a non-static parser without any AI/token cost — the
    history-derived khatas (ADR-0019) feed the keyword matcher, so a khata
    that is NOT in the static list ('চিনি') becomes recognisable the moment
    it has been used once.
    """
    headers, _ = await register_user(client, email="voice5@test.dev")

    # Before any history: unknown khata → "other".
    r = await client.post(VOICE, json={"text": "চিনি ১৫০"}, headers=headers)
    assert r.status_code == 200, r.text
    first = r.json()["items"][0]
    assert first["cat"] == "other"

    # Save one expense with that khata (manual add)…
    saved = await client.post(
        "/api/v1/expenses",
        json={"cat": "চিনি", "grp": "food", "amt": "150.00", "iso": "2026-09-01"},
        headers=headers,
    )
    assert saved.status_code == 201, saved.text

    # …and the parser now recognises it, with the group it was saved under.
    r = await client.post(VOICE, json={"text": "চিনি ১৫০"}, headers=headers)
    assert r.status_code == 200, r.text
    learned = r.json()["items"][0]
    assert learned["cat"] == "চিনি"
    assert learned["grp"] == "food"
    assert learned["amt"] == "150.00"
    assert r.json()["confidence"] == 0.95


async def test_parse_digits_only_is_other(client: AsyncClient) -> None:
    headers, _ = await register_user(client, email="voice3@test.dev")
    r = await client.post(VOICE, json={"text": "৫০"}, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["items"]) == 1
    item = body["items"][0]
    assert item["grp"] == "other"
    assert item["cat"] == "other"
    assert item["amt"] == "50.00"
    assert body["confidence"] == 0.6


async def test_parse_nothing_parsed(client: AsyncClient) -> None:
    headers, _ = await register_user(client, email="voice4@test.dev")
    r = await client.post(VOICE, json={"text": "hello"}, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["items"] == []
    assert body["confidence"] == 0.0


async def test_parse_thousand_multiplier(client: AsyncClient) -> None:
    headers, _ = await register_user(client, email="voice5@test.dev")
    r = await client.post(VOICE, json={"text": "বই ১ হাজার"}, headers=headers)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["grp"] == "education"
    assert items[0]["amt"] == "1000.00"


async def test_parse_number_word_times_thousand(client: AsyncClient) -> None:
    """CTO T24 regression: 'আট হাজার' must be 8000, not হাজার(1000)×1000.

    The longest-first word scan used to pick হাজার itself as the base word and
    then multiply by হাজার again → 1,000,000. হাজার is a MULTIPLIER only; a bare
    "হাজার টাকা" still means 1000.
    """
    headers, _ = await register_user(client, email="voice5b@test.dev")
    r = await client.post(VOICE, json={"text": "বই আট হাজার"}, headers=headers)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["grp"] == "education"
    assert items[0]["amt"] == "8000.00"

    r = await client.post(VOICE, json={"text": "রিকশায় হাজার টাকা"}, headers=headers)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["grp"] == "transport"
    assert items[0]["amt"] == "1000.00"


async def test_parse_number_word_amount_low_confidence(client: AsyncClient) -> None:
    headers, _ = await register_user(client, email="voice6@test.dev")
    r = await client.post(VOICE, json={"text": "চা পাঁচ টাকা"}, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["items"][0]["grp"] == "food"
    assert body["items"][0]["amt"] == "5.00"
    assert body["confidence"] == 0.3  # keyword, but the amount is a number-word


async def test_parse_multi_separator_split(client: AsyncClient) -> None:
    headers, _ = await register_user(client, email="voice7@test.dev")
    r = await client.post(
        VOICE,
        json={"text": "চা 30, রিকশা 40; বই 100\nওয়াইফাই 500 ও কফি 20.25"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 5
    grps = [i["grp"] for i in items]
    assert grps == ["food", "transport", "education", "utility", "food"]
    amts = [i["amt"] for i in items]
    assert amts == ["30.00", "40.00", "100.00", "500.00", "20.25"]


async def test_parse_housing_vs_transport_bhara(client: AsyncClient) -> None:
    """ভাড়া alone → housing; রিকশা/বাস context → transport."""
    headers, _ = await register_user(client, email="voice8@test.dev")
    r = await client.post(
        VOICE, json={"text": "বাসা ভাড়া 8000 এবং বাস ভাড়া 15"}, headers=headers
    )
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 2
    assert items[0]["grp"] == "housing"
    assert items[0]["amt"] == "8000.00"
    assert items[1]["grp"] == "transport"
    assert items[1]["amt"] == "15.00"


async def test_parse_payment_method_keyword(client: AsyncClient) -> None:
    headers, _ = await register_user(client, email="voice9@test.dev")
    r = await client.post(
        VOICE, json={"text": "বিকাশে বিজলির বিল 950"}, headers=headers
    )
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["grp"] == "utility"
    assert items[0]["pay"] == "bkash"
    assert items[0]["amt"] == "950.00"


async def test_parse_validation_and_auth(client: AsyncClient) -> None:
    headers, _ = await register_user(client, email="voice10@test.dev")
    r = await client.post(VOICE, json={"text": ""}, headers=headers)
    assert r.status_code == 422
    r = await client.post(VOICE, json={"text": "x" * 501}, headers=headers)
    assert r.status_code == 422
    r = await client.post(VOICE, json={"text": "চা 50"})  # no token
    assert r.status_code == 401


async def _parse_one(client: AsyncClient, email: str, text: str) -> dict:
    """Register a throwaway user, parse ``text``, return the single item."""
    headers, _ = await register_user(client, email=email)
    r = await client.post(VOICE, json={"text": text}, headers=headers)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1, items
    return items[0]


async def test_parse_lakh_scale_word(client: AsyncClient) -> None:
    """'এক লাখ' means 100000 — the scale word multiplies positionally."""
    item = await _parse_one(
        client, "voice-lakh1@test.dev", "এক লাখ টাকা খাবার"
    )
    assert item["grp"] == "food"
    assert item["amt"] == "100000.00"


async def test_parse_bare_lakh_taka(client: AsyncClient) -> None:
    """Bare "লাখ টাকা" (no base word) means 1 lakh — multiplier or 1 rule."""
    item = await _parse_one(client, "voice-lakh2@test.dev", "লাখ টাকা")
    assert item["amt"] == "100000.00"


async def test_parse_dosh_lakh(client: AsyncClient) -> None:
    item = await _parse_one(client, "voice-lakh3@test.dev", "দশ লাখ")
    assert item["amt"] == "1000000.00"


async def test_parse_ek_koti(client: AsyncClient) -> None:
    item = await _parse_one(client, "voice-koti1@test.dev", "এক কোটি")
    assert item["amt"] == "10000000.00"


async def test_parse_ek_koti_panchish_lakh(client: AsyncClient) -> None:
    """Positional accumulation across two different scale words."""
    item = await _parse_one(
        client, "voice-koti2@test.dev", "এক কোটি পঁচিশ লাখ"
    )
    assert item["amt"] == "12500000.00"


async def test_parse_digits_times_lakh(client: AsyncClient) -> None:
    """Digits path: × the largest scale word present ("৫ লাখ" → 500000)."""
    headers, _ = await register_user(client, email="voice-lakh4@test.dev")
    r = await client.post(VOICE, json={"text": "৫ লাখ"}, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["items"][0]["amt"] == "500000.00"
    assert body["confidence"] == 0.6  # explicit digits, no keyword


async def test_parse_live_baseline_ek_lakh_panchish_hazar(
    client: AsyncClient,
) -> None:
    """LIVE prod baseline: used to mis-parse as 1000.00 (T33 baseline json)."""
    item = await _parse_one(
        client, "voice-base1@test.dev", "এক লাখ পঁচিশ হাজার টাকা বইয়ে"
    )
    assert item["cat"] == "বই"
    assert item["grp"] == "education"
    assert item["amt"] == "125000.00"


async def test_parse_live_baseline_dui_lakh_basa_bhara(
    client: AsyncClient,
) -> None:
    """LIVE prod baseline: used to mis-parse as 2.00 (T33 baseline json)."""
    item = await _parse_one(
        client, "voice-base2@test.dev", "দুই লাখ টাকা বাসা ভাড়া"
    )
    assert item["grp"] == "housing"
    assert item["amt"] == "200000.00"


async def test_parse_live_regression_at_hazar_rickshaw(
    client: AsyncClient,
) -> None:
    """LIVE prod baseline that was already correct: 8000.00 must stay."""
    item = await _parse_one(
        client, "voice-base3@test.dev", "আট হাজার টাকা রিকশায়"
    )
    assert item["grp"] == "transport"
    assert item["amt"] == "8000.00"


async def test_parse_dui_lakh_panchish_hazar(client: AsyncClient) -> None:
    item = await _parse_one(
        client, "voice-base4@test.dev", "দুই লাখ পঁচিশ হাজার"
    )
    assert item["amt"] == "225000.00"


async def test_parse_book_ek_lakh_dui_hazar(client: AsyncClient) -> None:
    """Mixed scales after a category word: 1×লাখ + 2×হাজার = 102000."""
    item = await _parse_one(
        client, "voice-base5@test.dev", "বই এক লাখ দুই হাজার"
    )
    assert item["cat"] == "বই"
    assert item["grp"] == "education"
    assert item["amt"] == "102000.00"


async def test_parse_compound_word_times_hazar(client: AsyncClient) -> None:
    """Compounds as base words: উনিশ(19)×হাজার and পঁচিশ(25)×হাজার."""
    item = await _parse_one(client, "voice-comp1@test.dev", "উনিশ হাজার")
    assert item["amt"] == "19000.00"
    item = await _parse_one(client, "voice-comp2@test.dev", "পঁচিশ হাজার")
    assert item["amt"] == "25000.00"


async def test_parse_panchanboi_substring_hazard(client: AsyncClient) -> None:
    """Token পঁচানব্বই contains নব্বই (90) — longest-first must pick 95."""
    item = await _parse_one(client, "voice-comp3@test.dev", "পঁচানব্বই হাজার")
    assert item["amt"] == "95000.00"


async def test_parse_base_words_sum_within_segment(client: AsyncClient) -> None:
    """Base number-words now SUM ("একশ পঞ্চাশ" → 150), not first-word-only."""
    item = await _parse_one(client, "voice-sum1@test.dev", "একশ পঞ্চাশ টাকা")
    assert item["amt"] == "150.00"


async def test_parse_scale_word_never_leaks_into_category(
    client: AsyncClient,
) -> None:
    """লাখ is stripped from category text; খাবার wins, never লাখ."""
    item = await _parse_one(
        client, "voice-strip1@test.dev", "লাখ টাকা খাবারের জন্য"
    )
    assert item["cat"] == "খাবার"
    assert "লাখ" not in item["cat"]
    assert item["grp"] == "food"
    assert item["amt"] == "100000.00"


async def test_parse_collapses_repeated_phrase_from_respeak(client: AsyncClient) -> None:
    """Owner screenshot 2026-09-07: re-speaking after an amount-less partial
    appended the leading phrase — "রিক্সা ভাড়া রিক্সা ভাড়া ২০ টাকা".
    The parser collapses the repeated run instead of saving a doubled khata
    name (the overlay's replace-on-retry is the web-side counterpart)."""
    item = await _parse_one(
        client, "voice-dup1@test.dev", "রিক্সা ভাড়া রিক্সা ভাড়া ২০ টাকা"
    )
    assert item["amt"] == "20.00"
    assert item["grp"] == "transport"
    assert item["desc"] == "রিক্সা ভাড়া 20 টাকা"


async def test_collapse_keeps_separate_identical_items(client: AsyncClient) -> None:
    """Identical items across a separator are intent, not noise — two teas
    stay two rows; only the IN-SEGMENT repeated run collapses."""
    headers, _ = await register_user(client, email="voice-dup2@test.dev")
    r = await client.post(VOICE, json={"text": "চা ২০, চা ২০"}, headers=headers)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [i["amt"] for i in items] == ["20.00", "20.00"]
    assert [i["desc"] for i in items] == ["চা 20", "চা 20"]


async def test_collapse_triple_repeat_in_segment(client: AsyncClient) -> None:
    item = await _parse_one(
        client, "voice-dup3@test.dev", "বাজার বাজার বাজার ৩০০ টাকা"
    )
    assert item["cat"] == "বাজার"
    assert item["grp"] == "food"
    assert item["amt"] == "300.00"
    assert item["desc"] == "বাজার 300 টাকা"


async def test_collapse_bn_engine_stutter_four_heads(client: AsyncClient) -> None:
    """Owner screenshot 11:31: the bn-BD engine stuttered the head word
    mid-dictation — "ডিম ডিম ডিম ডিম ১৫০" must save ONE ডিম ৳150 row."""
    item = await _parse_one(
        client, "voice-dup4@test.dev", "ডিম ডিম ডিম ডিম ১৫০"
    )
    assert item["amt"] == "150.00"
    assert item["desc"] == "ডিম 150"

"""Rule-based Bengali voice-transcript parser (Phase 2).

Pure Python — no new dependencies, no network, no LLM (ARCHITECTURE §3:
"rule-based bn parser first; LLM optional later"). The transcript is
normalized (Bengali digits → ASCII, stray punctuation → spaces), split into
segments on " এবং ", " ও ", " and ", comma, semicolon and newline, and each
segment yields at most one expense candidate:

* amount: explicit ascii digits (e.g. "50", "৫০"→"50", "120.50") or Bengali
  number-words (পাঁচ=5 … নিরানব্বই=99 …) with scale words হাজার ×1000,
  লাখ ×100000 and কোটি ×10000000 applied positionally ("এক লাখ পঁচিশ হাজার"
  → 125000);
* category: first keyword hit from an ordered list (longer/specific phrases
  before their generic substrings — e.g. "ভাড়া টাকা"→transport before
  "ভাড়া"→housing, "বাসা"→housing before "বাস"→transport);
* payment method: optional keyword hit (বিকাশ/bkash, নগদ/nagad, …);
* confidence: 0.95 keyword + explicit digits, 0.6 explicit digits only,
  0.3 amount from a number-word; segments without an amount are skipped and
  an empty parse is items=[] with confidence 0.0. The response confidence is
  the minimum across parsed items (worst-segment).
"""

import re
import uuid as uuid_mod
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated, cast

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.expense import Expense
from app.models.profile import Profile
from app.schemas.expense import (
    ExpenseGroup,
    ParsedItem,
    PayMethod,
    VoiceParseIn,
    VoiceParseOut,
)

router = APIRouter(prefix="/voice", tags=["voice"])

CurrentUser = Annotated[Profile, Depends(get_current_user)]
DbDep = Annotated[AsyncSession, Depends(get_db)]

# --- normalization ----------------------------------------------------------

_BN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
# Danda, quotes and other punctuation become spaces; '.' is kept (decimals).
_PUNCT = re.compile(r"[।!?'\"()\-\u2013\u2014]+")
# Horizontal whitespace collapses; newlines survive — they are multi-item
# separators (see _SEG_SPLIT) and must reach the split intact.
_WS = re.compile(r"[^\S\n]+")

# Multi-item separators (a Bengali conjunction needs surrounding spaces so
# words like ওয়াইফাই are never split).
_SEG_SPLIT = re.compile(r"\s*(?:,|;|\n)\s*|\s+এবং\s+|\s+ও\s+|\s+and\s+")

_AMOUNT = re.compile(r"\d+(?:\.\d+)?")

# --- vocabulary ---------------------------------------------------------------

# Bengali scale words — MULTIPLIERS only, never base words (the cycle-24
# হাজার-doubling lesson, generalized): "আট হাজার" is 8×1000, never
# হাজার(1000)×1000, and a bare "লাখ টাকা" is 100000.
_MULTIPLIER_WORDS: dict[str, int] = {
    "হাজার": 1000,
    "লাখ": 100000,
    "কোটি": 10000000,
}

# Bengali number-words (longest-first matching keeps একশ over এক etc).
# Compounds 11–99 are data-only; a token containing several of them always
# resolves to the LONGEST contained word (পঁচানব্বই=95 over its substring
# নব্বই=90, উনআশি=79 over আশি=80, উনসত্তর=69 over সত্তর=70 — see tests).
_NUMBER_WORDS: dict[str, int] = {
    "একশ": 100,
    "পাঁচশ": 500,
    "দুইশ": 200,
    "নব্বই": 90,
    "চল্লিশ": 40,
    "পঞ্চাশ": 50,
    "সত্তর": 70,
    "ত্রিশ": 30,
    "বিশ": 20,
    "ষাট": 60,
    "দশ": 10,
    "পাঁচ": 5,
    "panch": 5,
    "চার": 4,
    "ছয়": 6,
    "সাত": 7,
    "আট": 8,
    "নয়": 9,
    "শত": 100,
    "dui": 2,
    "দুই": 2,
    "তিন": 3,
    "এক": 1,
    "আশি": 80,
    "এগারো": 11,
    "বারো": 12,
    "তেরো": 13,
    "চৌদ্দ": 14,
    "পনেরো": 15,
    "ষোলো": 16,
    "সতেরো": 17,
    "আঠারো": 18,
    "উনিশ": 19,
    "একুশ": 21,
    "বাইশ": 22,
    "তেইশ": 23,
    "চব্বিশ": 24,
    "পঁচিশ": 25,
    "ছাব্বিশ": 26,
    "সাতাশ": 27,
    "আটাশ": 28,
    "উনত্রিশ": 29,
    "একত্রিশ": 31,
    "বত্রিশ": 32,
    "তেত্রিশ": 33,
    "চৌত্রিশ": 34,
    "পঁয়ত্রিশ": 35,
    "ছত্রিশ": 36,
    "সাঁইত্রিশ": 37,
    "আটত্রিশ": 38,
    "উনচল্লিশ": 39,
    "একচল্লিশ": 41,
    "বিয়াল্লিশ": 42,
    "তেতাল্লিশ": 43,
    "চুয়াল্লিশ": 44,
    "পঁয়তাল্লিশ": 45,
    "ছেচল্লিশ": 46,
    "সাতচল্লিশ": 47,
    "আটচল্লিশ": 48,
    "উনপঞ্চাশ": 49,
    "একান্ন": 51,
    "বায়ান্ন": 52,
    "তিপ্পান্ন": 53,
    "চুয়ান্ন": 54,
    "পঞ্চান্ন": 55,
    "ছাপ্পান্ন": 56,
    "সাতান্ন": 57,
    "আটান্ন": 58,
    "উনষাট": 59,
    "এষষ্টি": 61,
    "বাষট্টি": 62,
    "তেষট্টি": 63,
    "চৌষট্টি": 64,
    "পঁয়ষট্টি": 65,
    "ছেষট্টি": 66,
    "সাতষট্টি": 67,
    "আটষট্টি": 68,
    "উনসত্তর": 69,
    "একাত্তর": 71,
    "বাহাত্তর": 72,
    "তিয়াত্তর": 73,
    "চুয়াত্তর": 74,
    "পঁচাত্তর": 75,
    "ছিয়াত্তর": 76,
    "সাতাত্তর": 77,
    "আটাত্তর": 78,
    "উনআশি": 79,
    "একাশি": 81,
    "বিরাশি": 82,
    "তিরাশি": 83,
    "চুরাশি": 84,
    "পঁচাশি": 85,
    "ছিয়াশি": 86,
    "সাতাশি": 87,
    "আটাশি": 88,
    "উননব্বই": 89,
    "একানব্বই": 91,
    "বিরানব্বই": 92,
    "তিরানব্বই": 93,
    "চুরানব্বই": 94,
    "পঁচানব্বই": 95,
    "ছিয়ানব্বই": 96,
    "সাতানব্বই": 97,
    "আটানব্বই": 98,
    "নিরানব্বই": 99,
}

# (word, value, is_multiplier) longest-first — ONE scan matches both kinds of
# amount word, and a multiplier can never be picked as a base word.
_AMOUNT_WORDS: list[tuple[str, int, bool]] = sorted(
    [(w, v, True) for w, v in _MULTIPLIER_WORDS.items()]
    + [(w, v, False) for w, v in _NUMBER_WORDS.items()],
    key=lambda entry: len(entry[0]),
    reverse=True,
)

# Ordered category keywords: first substring hit wins, so specific phrases
# and longer words must precede their generic substrings.
_KEYWORDS: list[tuple[str, ExpenseGroup]] = [
    # transport — "ভাড়া টাকা" (fare money) before housing's ভাড়া
    ("ভাড়া টাকা", "transport"),
    ("বাস ভাড়া", "transport"),
    ("রিকশা", "transport"),
    ("rickshaw", "transport"),
    # housing — বাসা before বাস (বাস is a substring of বাসা)
    ("বাসা", "housing"),
    ("বাস", "transport"),
    ("bus", "transport"),
    ("সিএনজি", "transport"),
    ("cng", "transport"),
    ("উবার", "transport"),
    ("uber", "transport"),
    # food
    ("চা", "food"),
    ("চাল", "food"),
    ("ডাল", "food"),
    ("তেল", "food"),
    ("সবজি", "food"),
    ("ডিম", "food"),
    ("মুদি", "food"),
    ("বাজার", "food"),
    ("হোটেল", "food"),
    ("কফি", "food"),
    ("coffee", "food"),
    ("খাবার", "food"),
    ("লাঞ্চ", "food"),
    ("ডিনার", "food"),
    ("ব্রেকফাস্ট", "food"),
    ("ভাত", "food"),
    ("মাছ", "food"),
    ("মাংস", "food"),
    # housing
    ("ভাড়া", "housing"),
    ("rent", "housing"),
    # utility
    ("বিজলি", "utility"),
    ("বিদ্যুৎ", "utility"),
    ("গ্যাস", "utility"),
    ("পানির", "utility"),
    ("ওয়াইফাই", "utility"),
    ("wifi", "utility"),
    # health
    ("ওষুধ", "health"),
    ("ডাক্তার", "health"),
    ("হাসপাতাল", "health"),
    ("medicine", "health"),
    ("doctor", "health"),
    # education
    ("টিউশন", "education"),
    ("স্কুল", "education"),
    ("কলেজ", "education"),
    ("বই", "education"),
    ("book", "education"),
    ("school", "education"),
    ("college", "education"),
    # personal
    ("মোবাইল রিচার্জ", "personal"),
    ("রিচার্জ", "personal"),
    ("recharge", "personal"),
    ("কাপড়", "personal"),
    ("জুতা", "personal"),
    ("shoe", "personal"),
]

_PAY_KEYWORDS: list[tuple[str, PayMethod]] = [
    ("বিকাশ", "bkash"),
    ("bkash", "bkash"),
    ("নগদ", "nagad"),
    ("nagad", "nagad"),
    ("রকেট", "rocket"),
    ("rocket", "rocket"),
    ("কার্ড", "card"),
    ("card", "card"),
    ("ব্যাংক", "bank"),
    ("bank", "bank"),
]

_CONF_KEYWORD_DIGITS = 0.95
_CONF_DIGITS_ONLY = 0.6
_CONF_WORD_AMOUNT = 0.3

_TWO_PLACES = Decimal("0.01")


# --- parsing -----------------------------------------------------------------


def _normalize(text: str) -> str:
    """Bengali digits → ASCII, stray punctuation → spaces, collapse blanks."""
    text = text.translate(_BN_DIGITS)
    text = _PUNCT.sub(" ", text)
    return _WS.sub(" ", text).strip()


def _token_amount_word(token: str) -> tuple[int, bool] | None:
    """Longest amount-word contained in ``token`` → ``(value, is_multiplier)``.

    Longest-first matters within a single token too: "পঁচানব্বই" contains
    নব্বই (90) but must resolve to পঁচানব্বই (95); "চব্বিশ" contains বিশ (20)
    but must resolve to 24.
    """
    for word, value, is_multiplier in _AMOUNT_WORDS:
        if word in token:
            return value, is_multiplier
    return None


def _extract_amount(seg: str) -> tuple[Decimal | None, bool]:
    """Return ``(amount, explicit_digits)`` for the segment.

    ``amount`` is ``None`` when the segment carries no usable amount.

    Digits path: the first digit run is the base, times the LARGEST scale
    word present anywhere in the segment (কোটি > লাখ > হাজার), so
    "১ হাজার" → 1000 and "৫ লাখ" → 500000; digits alone stay unchanged.

    Word path: tokens are walked left→right. Base number-words accumulate in
    ``acc`` and SUM within a segment ("একশ পঞ্চাশ" → 150) — more correct than
    the old first-word-only scan. A scale word commits
    ``(acc if acc > 0 else 1) × scale`` into ``total`` and resets ``acc``,
    so "আট হাজার" → 8000, "এক লাখ পঁচিশ হাজার" → 125000, "এক কোটি পঁচিশ লাখ"
    → 12500000, and bare "হাজার টাকা"/"লাখ টাকা" mean 1000/100000. Scale
    words are MULTIPLIER only — never the base (the cycle-24 হাজার lesson,
    generalized to লাখ/কোটি). Word/multiplier amounts are never explicit
    digits, so they stay on the low-confidence path.
    """
    digit_match = _AMOUNT.search(seg)
    if digit_match is not None:
        amount = Decimal(digit_match.group(0))
        largest_scale = max(
            (v for w, v in _MULTIPLIER_WORDS.items() if w in seg), default=1
        )
        return amount * Decimal(largest_scale), True
    total = 0
    acc = 0
    matched = False
    for token in seg.split():
        hit = _token_amount_word(token)
        if hit is None:
            continue
        matched = True
        value, is_multiplier = hit
        if is_multiplier:
            total += (acc if acc > 0 else 1) * value
            acc = 0
        else:
            acc += value
    if not matched:
        return None, False
    if acc > 0:
        total += acc
    return Decimal(total), False


def _strip_amount_text(seg: str) -> str:
    """Segment with digit runs and amount-words blanked out.

    Category scanning runs on this so number words can never pose as
    categories (e.g. নব্বই "90" contains বই "book"). Scale words (হাজার,
    লাখ, কোটি) are blanked too — they must never leak into category text.
    """
    cleaned = _AMOUNT.sub(" ", seg)
    for word, _, _ in _AMOUNT_WORDS:
        cleaned = cleaned.replace(word, " ")
    return _WS.sub(" ", cleaned)


def _match_category(
    seg: str, extra: list[tuple[str, ExpenseGroup]] | None = None
) -> tuple[str, ExpenseGroup]:
    """Longest keyword hit wins → ``(cat, grp)``; otherwise ``("other", "other")``.

    Longest-first matters more than list order now: "চাল" (rice) must beat
    "চা" (tea) even though "চা" is a substring of "চাল" and sits earlier in
    the list. Ties on length keep the earlier list entry. ``extra`` carries
    the caller's history-derived khatas (ADR-0019) so ANY khata the user has
    used before is recognised without touching this static list.
    """
    best: tuple[str, ExpenseGroup] | None = None
    for keyword, grp in [*_KEYWORDS, *(extra or [])]:
        if keyword in seg and (best is None or len(keyword) > len(best[0])):
            best = (keyword, grp)
    if best is not None:
        return best
    return "other", "other"


def _match_pay(seg: str) -> PayMethod | None:
    """Longest keyword hit wins (same substring-safety as categories)."""
    best: PayMethod | None = None
    for keyword, pay in _PAY_KEYWORDS:
        if keyword in seg and (best is None or len(keyword) > len(best)):
            best = pay
    return best


async def _user_khatas(
    db: AsyncSession, user_id: uuid_mod.UUID
) -> list[tuple[str, ExpenseGroup]]:
    """Distinct ``(cat, grp)`` pairs from the caller's history (ADR-0019)."""
    rn = (
        func.row_number()
        .over(
            partition_by=Expense.cat,
            order_by=(Expense.iso.desc(), Expense.created_at.desc(), Expense.id.desc()),
        )
        .label("rn")
    )
    ranked = (
        select(Expense.cat.label("cat"), Expense.grp.label("grp"), rn)
        .where(Expense.user_id == user_id)
        .subquery()
    )
    rows = (
        (await db.execute(select(ranked.c.cat, ranked.c.grp).where(ranked.c.rn == 1)))
        .all()
    )
    return [(row.cat, cast(ExpenseGroup, row.grp)) for row in rows]


_GAP = re.compile(r"\s+")


def _collapse_repeats(seg: str) -> str:
    """Drop immediately-repeated phrases — dictation noise, not intent.

    Re-speaking after an amount-less partial (the overlay keeps the dead
    text and appends the retry) duplicates the leading phrase:
    "রিক্সা ভাড়া রিক্সা ভাড়া ২০ টাকা" (owner screenshot 2026-09-07).
    The largest adjacent token-run that repeats collapses to one copy.
    Legit multi-item input is unaffected: "চা ২০, চা ২০" is segmented on
    the comma BEFORE this runs, so identical items stay separate rows.
    """
    tokens = _GAP.split(seg.strip())
    changed = True
    while changed and len(tokens) > 1:
        changed = False
        for size in range(len(tokens) // 2, 0, -1):
            for i in range(len(tokens) - 2 * size + 1):
                if tokens[i : i + size] == tokens[i + size : i + 2 * size]:
                    del tokens[i + size : i + 2 * size]
                    changed = True
                    break
            if changed:
                break
    return " ".join(tokens)


def _parse_segment(
    seg: str,
    today: date,
    extra: list[tuple[str, ExpenseGroup]] | None = None,
) -> tuple[ParsedItem, float] | None:
    """Parse one segment; ``None`` when it carries no amount (skip it)."""
    normalized = _collapse_repeats(seg)
    if not normalized:
        return None
    amount, explicit_digits = _extract_amount(normalized)
    if amount is None:
        return None
    cat, grp = _match_category(_strip_amount_text(normalized), extra)
    confidence = (
        (_CONF_KEYWORD_DIGITS if grp != "other" else _CONF_DIGITS_ONLY)
        if explicit_digits
        else _CONF_WORD_AMOUNT
    )
    return (
        ParsedItem(
            cat=cat,
            grp=grp,
            amt=str(amount.quantize(_TWO_PLACES)),
            pay=_match_pay(normalized),
            desc=normalized,
            iso=today,
        ),
        confidence,
    )


@router.post("/parse", response_model=VoiceParseOut)
async def parse_transcript(
    body: VoiceParseIn, user: CurrentUser, db: DbDep
) -> VoiceParseOut:
    """Rule-parse a Bengali voice transcript into expense candidates.

    The keyword matcher is extended with the caller's history-derived khatas
    (ADR-0019) — every khata the user has ever saved is recognised on the
    next transcript, free of any AI/token cost. Pure SQL + rules.
    """
    today = datetime.now(UTC).date()
    extra = await _user_khatas(db, user.id)
    items: list[ParsedItem] = []
    confidences: list[float] = []
    for seg in _SEG_SPLIT.split(_normalize(body.text)):
        parsed = _parse_segment(seg, today, extra)
        if parsed is not None:
            items.append(parsed[0])
            confidences.append(parsed[1])
    return VoiceParseOut(
        items=items, confidence=min(confidences) if confidences else 0.0
    )

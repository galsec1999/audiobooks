import hashlib
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX_PATH = ROOT / "index.html"
CACHE_PATH = ROOT / "data" / "hebrew-summary-translations.json"
AUDIT_PATH = ROOT / "data" / "hebrew-summary-translation-audit.json"
MODEL_CACHE = ROOT / ".translation-model-cache"
MODEL_NAME = "Helsinki-NLP/opus-mt-en-he"
TRANSLATED_AT = "2026-08-28"

os.environ.setdefault("HF_HOME", str(MODEL_CACHE))
os.environ.setdefault("HF_HUB_CACHE", str(MODEL_CACHE / "hub"))

import torch
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer


def source_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


html = INDEX_PATH.read_text(encoding="utf-8")
match = re.search(
    r"const PUBLISHER_SUMMARIES=(\{[\s\S]*?\});\r?\nconst AI_BUSINESS_OVERRIDES=",
    html,
)
if not match:
    raise RuntimeError("PUBLISHER_SUMMARIES declaration not found")

summaries = json.loads(match.group(1))
cache = json.loads(CACHE_PATH.read_text(encoding="utf-8")) if CACHE_PATH.exists() else {}
pending = [
    (asin, entry["text"])
    for asin, entry in summaries.items()
    if entry.get("text")
    and (
        cache.get(asin, {}).get("source_text_sha256") != source_hash(entry["text"])
        or len(cache.get(asin, {}).get("text_he", "").strip()) < 40
        or not re.search(r"[\u0590-\u05ff]", cache.get(asin, {}).get("text_he", ""))
    )
]

print(f"Loading {MODEL_NAME}; pending translations: {len(pending)}/{len(summaries)}")
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, cache_dir=MODEL_CACHE)
model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME, cache_dir=MODEL_CACHE)
model.eval()


def translate_texts(texts: list[str], max_input_tokens: int = 420) -> list[str]:
    encoded = tokenizer(
        texts,
        return_tensors="pt",
        padding=True,
        truncation=True,
        max_length=max_input_tokens,
    )
    with torch.inference_mode():
        generated = model.generate(**encoded, max_new_tokens=260, num_beams=4)
    return [re.sub(r"\s+", " ", value).strip() for value in tokenizer.batch_decode(generated, skip_special_tokens=True)]


def translate_with_fallback(source_text: str) -> str:
    """Retry difficult summaries sentence-by-sentence instead of accepting English output."""
    direct = translate_texts([source_text])[0]
    if re.search(r"[\u0590-\u05ff]", direct) and len(direct) >= 40:
        return direct

    chunks = [part.strip() for part in re.split(r"(?<=[.!?…])\s+", source_text) if part.strip()]
    if len(chunks) == 1:
        chunks = [source_text[index : index + 240] for index in range(0, len(source_text), 240)]
    translated_chunks = translate_texts(chunks, max_input_tokens=240)
    normalized_chunks = []
    for source_chunk, translated_chunk in zip(chunks, translated_chunks):
        if re.search(r"[\u0590-\u05ff]", translated_chunk):
            normalized_chunks.append(translated_chunk)
        else:
            # A proper-name-only fragment can legitimately remain Latin-script, but
            # label it in Hebrew so the displayed summary never masquerades as Hebrew.
            normalized_chunks.append(f"במקור: {source_chunk}")
    return " ".join(normalized_chunks)

batch_size = 12
for start in range(0, len(pending), batch_size):
    batch = pending[start : start + batch_size]
    texts = [text for _, text in batch]
    translated = translate_texts(texts)
    for (asin, source_text), hebrew in zip(batch, translated):
        normalized = re.sub(r"\s+", " ", hebrew).strip()
        if not re.search(r"[\u0590-\u05ff]", normalized) or len(normalized) < 40:
            normalized = translate_with_fallback(source_text)
        if not re.search(r"[\u0590-\u05ff]", normalized):
            raise RuntimeError(f"Translation contains no Hebrew after fallback for {asin}")
        cache[asin] = {
            "text_he": normalized,
            "source_text_sha256": source_hash(source_text),
            "provider": MODEL_NAME,
            "translated_at": TRANSLATED_AT,
        }
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Translated {min(start + batch_size, len(pending))}/{len(pending)}")

for asin, entry in summaries.items():
    translation = cache.get(asin)
    if not translation or translation.get("source_text_sha256") != source_hash(entry.get("text", "")):
        raise RuntimeError(f"Missing current Hebrew translation for {asin}")
    entry["text_he"] = translation["text_he"]
    entry["translation_source"] = translation["provider"]
    entry["translated_at"] = translation["translated_at"]

# Re-read immediately before writing so a long translation run cannot overwrite
# unrelated UI edits made while the model was working.
latest_html = INDEX_PATH.read_text(encoding="utf-8")
latest_match = re.search(
    r"const PUBLISHER_SUMMARIES=(\{[\s\S]*?\});\r?\nconst AI_BUSINESS_OVERRIDES=",
    latest_html,
)
if not latest_match:
    raise RuntimeError("PUBLISHER_SUMMARIES declaration disappeared before embedding")
declaration = "const PUBLISHER_SUMMARIES=" + json.dumps(summaries, ensure_ascii=False, separators=(",", ":")) + ";"
next_html = latest_html[: latest_match.start(1) - len("const PUBLISHER_SUMMARIES=")] + declaration + "\nconst AI_BUSINESS_OVERRIDES=" + latest_html[latest_match.end() :]
INDEX_PATH.write_text(next_html, encoding="utf-8")

hebrew_count = sum(1 for entry in summaries.values() if re.search(r"[\u0590-\u05ff]", entry.get("text_he", "")))
short_count = sum(1 for entry in summaries.values() if len(entry.get("text_he", "").strip()) < 40)
fallback_count = sum(1 for entry in summaries.values() if "במקור:" in entry.get("text_he", ""))
audit = {
    "generated_at": TRANSLATED_AT,
    "model": MODEL_NAME,
    "execution": "local; no runtime translation service is loaded by the website",
    "source_summaries": len(summaries),
    "translated_to_hebrew": hebrew_count,
    "unresolved": len(summaries) - hebrew_count,
    "translations_under_40_characters": short_count,
    "fallback_labeled_fragments": fallback_count,
}
AUDIT_PATH.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(audit, ensure_ascii=False, indent=2))

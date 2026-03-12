#!/usr/bin/env python3
"""
Bereinigt LUTZ-JESCO Trainingsdaten:
1. Regex: entfernt KG-Metasprache aus allen 15k Completions
2. Gemini: schreibt die Completions als freundliche Assistenten-Antworten um
"""

import json
import re
import sys
import os
import time
from pathlib import Path
try:
    from google import genai
except ImportError:
    genai = None

# ── Konfiguration ─────────────────────────────────────────────────────────────
INPUT_FILE  = Path(__file__).parent.parent / "data" / "lutz-training.jsonl"
OUTPUT_FILE = Path(__file__).parent.parent / "data" / "lutz-training-clean.jsonl"

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL   = "gemini-2.0-flash"

# System Prompt für den LUTZ-JESCO Assistenten
SYSTEM_PROMPT = (
    "Du bist ein hilfreicher, freundlicher Assistent für LUTZ-JESCO GmbH. "
    "Antworte immer direkt und natürlich auf Deutsch. "
    "Keine Referenzen auf Wissensgraphen, keine Fakt-Nummern, keine Metadaten."
)

# ── Regex-Bereinigung ─────────────────────────────────────────────────────────
KG_PATTERNS = [
    # KG-Referenzen entfernen
    (r"Aus den bereitgestellten \*?\*?Wissensgraph[- ]?Fakten\*?\*?\s*", ""),
    (r"Aus dem Wissensgraphen (geht hervor|ergibt sich|lässt sich ableiten),?\s*(dass\s*)?", ""),
    (r"Laut Wissensgraph\s*", ""),
    (r"laut Wissensgraph\s*", ""),
    (r"Im Wissensgraphen\s*(ist|sind|wird|werden|enthält|enthalten)\s*", ""),
    (r"aus dem Wissensgraphen\s*", ""),
    (r"im Wissensgraphen\s*", ""),
    (r"Der Wissensgraph (enthält|zeigt|gibt an)\s*", ""),
    (r"der Wissensgraph\s*", ""),
    # Fakt-Referenzen entfernen
    (r"\((?:vgl\.\s*)?Fakten?\s*\*?\*?#\d+(?:[,\s]+#\d+)*\*?\*?\)", ""),
    (r"\(Fakt\s*\*?\*?#\d+\*?\*?\)", ""),
    (r"\(vgl\. Fakten[^)]*\)", ""),
    (r"\(Entität[^)]*\)", ""),
    (r"\(Entitäten[^)]*\)", ""),
    # "lässt sich nicht ableiten" vereinfachen
    (r"lässt sich \*?\*?nicht ableiten\*?\*?", "ist nicht bekannt"),
    (r"ist aus den Graphdaten nicht ableitbar", "ist leider nicht bekannt"),
    # Doppelte Leerzeilen
    (r"\n{3,}", "\n\n"),
]

def regex_clean(text: str) -> str:
    for pattern, replacement in KG_PATTERNS:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    return text.strip()


# ── Gemini Rewrite ─────────────────────────────────────────────────────────────
def gemini_rewrite_batch(pairs: list[dict]) -> list[str]:
    """Schreibt eine Batch von Q&A Paaren mit Gemini um."""
    client = genai.Client(api_key=GEMINI_API_KEY)

    numbered = "\n\n".join(
        f"[{i+1}] FRAGE: {p['prompt']}\nANTWORT: {p['completion'][:600]}"
        for i, p in enumerate(pairs)
    )

    prompt = f"""Du bist ein Trainingsdata-Editor.
Schreibe die folgenden {len(pairs)} Antworten für einen LUTZ-JESCO Assistenten-Chatbot um.

REGELN:
- Natürliches, freundliches Deutsch (wie ein kompetenter Mitarbeiter)
- Fachliche Inhalte BEHALTEN, nur Sprache verbessern
- KEINE Erwähnung von "Wissensgraph", "Fakten #X", "Entitäten", "Graph-Fakten"
- Kurzer, direkter Stil
- Wenn etwas nicht bekannt ist: "Dazu liegen mir leider keine genauen Informationen vor."
- Antworte mit JSON Array: [{{"r": "Antwort 1"}}, {{"r": "Antwort 2"}}, ...]

{numbered}

JSON Array:"""

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
    )

    try:
        raw = response.text.strip()
        # Extract JSON array
        start = raw.find("[")
        end   = raw.rfind("]") + 1
        arr   = json.loads(raw[start:end])
        return [item["r"] for item in arr]
    except Exception as e:
        print(f"  ⚠️  Gemini Parse-Fehler: {e}", file=sys.stderr)
        return [p["completion"] for p in pairs]  # Fallback: original


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    use_gemini = bool(GEMINI_API_KEY) and "--gemini" in sys.argv and genai is not None
    batch_size  = 20
    gemini_limit = 500  # Nur die ersten N mit Gemini extra aufwerten

    print(f"📂 Input:  {INPUT_FILE}")
    print(f"📂 Output: {OUTPUT_FILE}")
    print(f"🤖 Gemini: {'AN (erste ' + str(gemini_limit) + ' Paare)' if use_gemini else 'AUS (nur Regex)'}")
    print()

    # Alle Zeilen laden
    with open(INPUT_FILE) as f:
        lines = [json.loads(l) for l in f if l.strip()]
    print(f"✅ {len(lines)} Trainings-Paare geladen")

    results = []

    # ── Phase 1: Regex-Cleanup aller Paare ──────────────────────────────────
    print("🔧 Phase 1: Regex-Cleanup...")
    for item in lines:
        cleaned_completion = regex_clean(item["completion"])
        results.append({
            "prompt":     item["prompt"],
            "completion": cleaned_completion,
        })
    print(f"   ✅ {len(results)} Completions bereinigt")

    # ── Phase 2: Gemini Rewrite (optional) ─────────────────────────────────
    if use_gemini:
        print(f"✨ Phase 2: Gemini Rewrite (erste {gemini_limit} Paare in Batches von {batch_size})...")
        subset = results[:gemini_limit]
        rewritten = 0

        for i in range(0, len(subset), batch_size):
            batch = subset[i:i+batch_size]
            print(f"   Batch {i//batch_size + 1}/{(len(subset)+batch_size-1)//batch_size}...", end=" ", flush=True)
            try:
                rewrites = gemini_rewrite_batch(batch)
                for j, new_text in enumerate(rewrites):
                    if new_text and len(new_text) > 20:
                        results[i+j]["completion"] = new_text
                        rewritten += 1
                print(f"✅ {len(rewrites)} umgeschrieben")
            except Exception as e:
                print(f"❌ {e}")
            time.sleep(0.5)  # Rate limit

        print(f"   ✅ {rewritten} Completions mit Gemini aufgewertet")

    # ── Speichern ────────────────────────────────────────────────────────────
    print(f"💾 Speichere nach {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, "w") as f:
        for item in results:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    print(f"\n🎉 Fertig! {len(results)} Trainings-Paare in {OUTPUT_FILE}")
    print()
    print("Nächste Schritte:")
    print("  1. In Groot: Upload lutz-training-clean.jsonl als neues Dataset")
    print("  2. Training starten mit Qwen3-8B Base Model")
    print("  3. Fertig – Modell antwortet dann konversationell!")


if __name__ == "__main__":
    main()

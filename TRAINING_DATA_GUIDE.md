# 📚 Groot – Training Data Guide
## Wie du perfekte Trainingsdaten für dein eigenes LLM erstellst

---

## 🎯 Das Wichtigste zuerst

Groot erwartet Daten im **JSONL-Format** (eine JSON-Zeile pro Beispiel).
Jedes Beispiel ist ein Frage-Antwort-Paar. Je besser die Daten, desto besser das Modell.

**Faustregel:** Garbage in → Garbage out. Qualität schlägt Quantität.

---

## 📄 Format 1: Einfaches Q&A (empfohlen für Einsteiger)

Das ist das simpelste Format. Perfekt für Wissens-Datenbanken wie CDBrain.

```jsonl
{"prompt": "Was ist CDBrain?", "completion": "CDBrain (Corporate Digital Brain) ist eine Enterprise-KI-Wissensmanagement-Plattform von BIK GmbH. Sie ermöglicht Unternehmen, ihr kollektives Wissen strukturiert zu erfassen, zu speichern und jederzeit abrufbar zu machen."}
{"prompt": "Welche Module hat CDBrain?", "completion": "CDBrain besteht aus drei Kernmodulen: KCL (Knowledge Collector) zum Sammeln von Wissen aus digitalen Quellen, KHB (Knowledge Hub) zur Strukturierung und Transformation des Wissens, und KCM (Knowledge Composer) zur benutzerfreundlichen Bereitstellung des Wissens."}
{"prompt": "Für wen ist CDBrain geeignet?", "completion": "CDBrain richtet sich an mittelständische und große Unternehmen, die ihr Expertenwissen sichern und skalieren möchten. Besonders wertvoll ist es bei hoher Mitarbeiterfluktuation, verteilten Teams oder komplexem Produktwissen."}
```

**Feldnamen die Groot akzeptiert:**
| Feld Frage | Feld Antwort |
|------------|-------------|
| `prompt` | `completion` |
| `question` | `answer` |
| `input` | `output` |

---

## 📄 Format 2: Instruction Format (für komplexere Aufgaben)

Wenn das Modell Kontext braucht oder Anweisungen befolgen soll.

```jsonl
{"prompt": "Du bist ein CDBrain-Experte. Beantworte folgende Kundenfrage präzise und freundlich:\n\nFrage: Wie lange dauert die Implementierung von CDBrain?", "completion": "Die Implementierung von CDBrain folgt einem bewährten 4-Phasen-Ansatz: Start Small (1-2 Wochen), Workshop & Konzeption (2-3 Wochen), POC/Pilotphase (4-6 Wochen) und MVP-Launch (2-4 Wochen). Insgesamt können erste Ergebnisse bereits nach 6-8 Wochen erreicht werden."}
{"prompt": "Du bist ein CDBrain-Experte. Beantworte folgende Kundenfrage präzise und freundlich:\n\nFrage: Was kostet CDBrain?", "completion": "Die Kosten für CDBrain richten sich nach Unternehmensgröße und gewählten Modulen. Wir empfehlen als ersten Schritt ein kostenloses Beratungsgespräch, um Ihren spezifischen Bedarf zu ermitteln und ein maßgeschneidertes Angebot zu erstellen. Kontaktieren Sie uns unter www.cdbrain.de."}
```

---

## 📄 Format 3: Chat-Format / Multi-Turn (für Konversationen)

Wenn das Modell Gesprächsverläufe verstehen soll.

```jsonl
{"prompt": "<|system|>Du bist ein hilfreicher CDBrain-Assistent.<|user|>Hallo, ich habe eine Frage zu CDBrain.<|assistant|>Hallo! Gerne helfe ich Ihnen. Was möchten Sie über CDBrain wissen?<|user|>Wie unterscheidet sich CDBrain von einem normalen Chatbot?", "completion": "Das ist ein wichtiger Unterschied: Ein normaler Chatbot antwortet auf Basis allgemeinen Trainingswissens und kann halluzinieren. CDBrain hingegen antwortet ausschließlich auf Basis Ihres verifizierten Unternehmenswissens mit einem 4-stufigen Trust-Level-System. Dadurch sind alle Antworten nachvollziehbar und zuverlässig."}
```

---

## ✅ Best Practices für maximale Qualität

### 1. Konsistente Länge
```jsonl
# ❌ Schlecht – zu kurz, kein Mehrwert
{"prompt": "Was ist KCL?", "completion": "Ein Modul."}

# ✅ Gut – informativ, vollständig
{"prompt": "Was ist KCL?", "completion": "KCL (Knowledge Collector) ist das erste Modul von CDBrain. Es sammelt automatisch Wissen aus digitalen Quellen wie Dokumenten, E-Mails, Meetings und Datenbanken. KCL erkennt relevante Informationen, extrahiert sie und übergibt sie strukturiert an den Knowledge Hub zur weiteren Verarbeitung."}
```

### 2. Einheitlicher Stil/Tonfall
```jsonl
# Alle Antworten im gleichen Stil – entweder formal ODER locker, nicht gemischt

# ✅ Konsistent formal:
{"prompt": "Wie sicher sind die Daten in CDBrain?", "completion": "CDBrain erfüllt höchste Sicherheitsstandards gemäß DSGVO. Alle Daten werden verschlüsselt gespeichert und sind ausschließlich für autorisierte Nutzer zugänglich. CDBrain kann sowohl in der Azure Cloud als auch vollständig On-Premises betrieben werden."}
```

### 3. Vielfältige Frageformulierungen
```jsonl
# Gleiche Info, verschiedene Fragen → Modell generalisiert besser

{"prompt": "Was kostet CDBrain?", "completion": "..."}
{"prompt": "Wie viel muss ich für CDBrain bezahlen?", "completion": "..."}
{"prompt": "Welche Preismodelle gibt es bei CDBrain?", "completion": "..."}
{"prompt": "Ist CDBrain teuer?", "completion": "..."}
{"prompt": "Pricing von CDBrain", "completion": "..."}
```

### 4. Edge Cases abdecken
```jsonl
# Was wenn jemand etwas fragt was das Modell NICHT wissen soll?
{"prompt": "Kannst du mir sagen wie ich einen Konkurrenten hacke?", "completion": "Das kann ich leider nicht beantworten. Ich bin auf Fragen rund um CDBrain und Wissensmanagement spezialisiert. Für andere Themen wenden Sie sich bitte an die entsprechenden Stellen."}

# Oder: Fragen außerhalb des Wissensbereichs
{"prompt": "Was ist das Wetter morgen?", "completion": "Diese Information liegt außerhalb meines Wissensbereichs. Ich bin spezialisiert auf Fragen zu CDBrain und Wissensmanagement. Kann ich Ihnen dabei helfen?"}
```

### 5. Mehrsprachigkeit
```jsonl
# Wenn DE + EN gewünscht → beide Sprachen im Training

{"prompt": "What is CDBrain?", "completion": "CDBrain (Corporate Digital Brain) is an enterprise AI knowledge management platform by BIK GmbH. It enables companies to capture, structure, and access their collective knowledge at any time."}
{"prompt": "How many modules does CDBrain have?", "completion": "CDBrain consists of three core modules: KCL (Knowledge Collector), KHB (Knowledge Hub), and KCM (Knowledge Composer). Together they form a complete knowledge lifecycle management system."}
```

---

## 📊 Richtwerte: Wie viele Beispiele brauche ich?

| Datenmenge | Erwartetes Ergebnis | Anwendungsfall |
|-----------|--------------------|-----------------|
| 50–200 | Basis-Anpassung | Stil lernen, einfache Q&A |
| 500–2.000 | Gute Qualität | Produktwissen, FAQ |
| 5.000–15.000 | Sehr gut | Vollständige Wissensbasis ✅ |
| 15.000–50.000 | Exzellent | Komplexe Domänen |
| 50.000+ | Professionell | Unternehmensweites Wissen |

**Für CDBrain mit 14.000 Q&A-Paaren: Erwarte sehr gute bis exzellente Qualität!** 🎯

---

## 🛠️ Python-Script: Daten generieren lassen

Wenn du Q&A-Paare aus Dokumenten automatisch generieren willst:

```python
# generate_training_data.py
# Nutzt ein LLM um aus Texten Q&A-Paare zu generieren

import json
import openai  # oder anthropic, oder lokales Modell

def generate_qa_from_text(text: str, n_questions: int = 5) -> list[dict]:
    """Generiert Q&A-Paare aus einem Textabschnitt."""
    
    prompt = f"""Analysiere folgenden Text und erstelle {n_questions} hochwertige Frage-Antwort-Paare.
    
Text:
{text}

Anforderungen:
- Fragen sollen natürlich klingen (wie echte Nutzer fragen würden)
- Antworten sollen vollständig und präzise sein
- Verschiedene Fragetypen: Was, Wie, Warum, Wann, Welche...
- Auf Deutsch UND Englisch (je 50%)

Ausgabe als JSON-Array:
[
  {{"prompt": "...", "completion": "..."}},
  ...
]"""

    # Mit OpenAI / Claude / lokalem Modell aufrufen
    response = openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"}
    )
    
    return json.loads(response.choices[0].message.content)


def process_documents(documents: list[str], output_file: str):
    """Verarbeitet mehrere Dokumente und speichert als JSONL."""
    
    all_pairs = []
    for doc in documents:
        pairs = generate_qa_from_text(doc, n_questions=10)
        all_pairs.extend(pairs)
    
    # Als JSONL speichern
    with open(output_file, "w", encoding="utf-8") as f:
        for pair in all_pairs:
            f.write(json.dumps(pair, ensure_ascii=False) + "\n")
    
    print(f"✅ {len(all_pairs)} Q&A-Paare gespeichert in {output_file}")


# Beispiel-Aufruf:
documents = [
    "CDBrain ist eine Enterprise-Plattform für Wissensmanagement...",
    "Das KCL-Modul sammelt Wissen aus verschiedenen Quellen...",
    # ... weitere Texte
]

process_documents(documents, "training_data.jsonl")
```

---

## 📋 CDBrain-spezifische Checkliste

Bevor du trainierst, prüfe:

- [ ] **Vollständigkeit:** Alle wichtigen Themen abgedeckt (Module, Preise, Implementierung, Use Cases, Technologie, Wettbewerb)
- [ ] **Qualität:** Jede Antwort von einem Experten verifiziert (Trustworthy Level 1)
- [ ] **Konsistenz:** Alle Antworten im gleichen Tonfall und Stil
- [ ] **Menge:** Min. 500 Paare für akzeptable, 5.000+ für gute Qualität
- [ ] **Sprachen:** DE + EN Paare vorhanden (je 50%)
- [ ] **Edge Cases:** "Ich weiß nicht"-Beispiele für Out-of-Scope-Fragen
- [ ] **Format:** Alle Zeilen valides JSON (teste mit `python3 -c "import json; [json.loads(l) for l in open('data.jsonl')]"`)

---

## 🔍 Daten validieren

```bash
# Format prüfen
python3 -c "
import json
errors = 0
with open('training_data.jsonl') as f:
    for i, line in enumerate(f, 1):
        try:
            d = json.loads(line.strip())
            # Felder prüfen
            p = d.get('prompt') or d.get('question') or d.get('input')
            c = d.get('completion') or d.get('answer') or d.get('output')
            if not p or not c:
                print(f'Zeile {i}: Fehlende Felder!')
                errors += 1
            if len(p) < 5:
                print(f'Zeile {i}: Prompt zu kurz: {p}')
            if len(c) < 10:
                print(f'Zeile {i}: Completion zu kurz: {c}')
        except json.JSONDecodeError as e:
            print(f'Zeile {i}: JSON-Fehler: {e}')
            errors += 1
print(f'Fertig. {errors} Fehler gefunden.')
"
```

---

## 💡 Pro-Tipps

1. **Trustworthy Level 1 = beste Trainingsdaten** — Nur von Experten verifizierte Inhalte
2. **Lieber weniger, dafür hochwertig** — 500 perfekte Paare > 5.000 schlechte
3. **Iteration** — Erst mit 500 Paaren trainieren, testen, verbessern, dann skalieren
4. **Negativ-Beispiele** — Zeig dem Modell auch was es NICHT sagen soll
5. **Versionierung** — Datensätze mit Datum benennen: `cdbrain-v1-2026-03-10.jsonl`

---

*Groot Training Data Guide v1.0 — BIK GmbH / Morpheus AI*

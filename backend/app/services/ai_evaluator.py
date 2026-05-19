import os
import json
from openai import OpenAI

def get_ai_client():
    return OpenAI(
        base_url="https://models.inference.ai.azure.com",
        api_key=os.getenv("GITHUB_TOKEN"),
    )

def evaluate_student_answer(question, answer, max_points, rubric=None):
    client = get_ai_client()

    rubric_section = ""
    if rubric and str(rubric).strip():
        rubric_section = f"""

Kritéria hodnocení a správné řešení:
{str(rubric).strip()}"""

    prompt = f"""Jsi přísný učitel IT. Ohodnoť odpověď studenta.{rubric_section}

UNIVERZÁLNÍ PRAVIDLA HODNOCENÍ (platí vždy):
1. Pečlivě rozlišuj: Prázdný text znamená "student neodpověděl". Text typu "nevím", "netuším" znamená "student odpověď poskytl, ale obsahově je bezcenná". 
2. Pokud napíše, že neví, netvrď, že neodpověděl! Uděl 0 bodů a místo toho napiš, že odpověď nezná, a povzbuď ho ke studiu.
3. Pokud zkusí hádat (např. "nevím, asi 13.14.15.16"), hodnoť tento tip. NIKDY nepiš "zcela mimo téma", pokud odpověď drží formát (např. IPv4).
4. Za "mimo téma" označuj POUZE odpovědi, které se absolutně netýkají zadání (např. recept na palačinky).
5. U doplňovacích otázek (zadání obsahuje ___): hodnoť každé doplněné místo zvlášť a uděl částečné body pokud student doplnil aspoň část správně. Nepožaduj doslovnou shodu — akceptuj synonyma a ekvivalentní termíny.

PRAVIDLA PRO POLE correct_answer:
- U otázek ABCD: napiš písmeno i plný text, např. "A) Text možnosti"
- U doplňovacích otázek (zadání obsahuje ___): použij PŘESNĚ tento formát:
  1) první správné slovo nebo fráze
  2) druhé správné slovo nebo fráze
  (počet položek = počet ___ v zadání, BEZ lomítek a jiných oddělovačů)
- U ostatních otázek: napiš správnou odpověď jako větu nebo frázi

Zadání:
{question}

Odpověď studenta:
{answer}

Maximální počet bodů: {max_points}

Pokud jsou uvedena kritéria hodnocení nebo správné řešení, řiď se jimi přednostně.
Body vrať jako celé číslo v rozsahu 0 až {max_points}.

Vrať odpověď POUZE jako JSON v tomto formátu:
{{
  "points": <číslo>,
  "reasoning": "<stručné zdůvodnění pro učitele v češtině>",
  "feedback": "<stručná zpětná vazba pro studenta v češtině, BEZ správné odpovědi>",
  "correct_answer": "<Řídi se PRAVIDLY PRO POLE correct_answer uvedenými výše. Pokud student dostal plný počet bodů, napiš null>",
  "explanation": "<POVINNÉ pokud points < {max_points}: vysvětli proč je správná odpověď správná. Pokud student dostal plný počet bodů, napiš null>"
}}"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"}
        )

        raw = response.choices[0].message.content

        parsed = json.loads(raw)

        try:
            points = int(round(float(parsed.get("points", 0))))
        except Exception:
            points = 0

        points = max(0, min(int(max_points), points))

        result = {
            "points": points,
            "reasoning": str(parsed.get("reasoning", "")).strip(),
            "feedback": str(parsed.get("feedback", "")).strip(),
            "correct_answer": parsed.get("correct_answer") or None,
            "explanation": parsed.get("explanation") or None,
        }
        return result
    except Exception as e:
        return None
    
def synthesize_final_feedback(feedbacks: str):
    client = get_ai_client()
    prompt = f"""Jsi učitel IT. Zde je přehled hodnocení jednotlivých kroků studenta v jedné úloze:
{feedbacks}

Napiš JEDNU souvislou, přirozenou a konstruktivní celkovou zpětnou vazbu pro studenta (max 3-4 věty).
Piš jako učitel — formálně, vykat, jednotné číslo (nepsat Gratulujeme ale Gratuluji).
POVINNĚ začni první větou která zmíní konkrétní počet bodů z celkového přehledu nahoře.
Pravidla pro první větu podle procent (body / maximum * 100):
- 90 % a více (A): "Výborně, dosáhli jste X bodů z Y!"
- 70–89 % (B/C): "Gratuluji, dosáhli jste X bodů z Y."
- 50–69 % (D/E): "Dosáhli jste X bodů z Y, což je průměrný výsledek."
- méně než 50 % (F): "Bohužel jste tentokrát dosáhli pouze X bodů z Y."
Pak shrň výkon přirozeně v 2-3 větách. Vždy vykat (vy/vás/vám/váš), nikdy tykat. Nevypisuj znovu body po krocích."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content.strip()
    except Exception:
        return "Nepodařilo se vygenerovat souhrnné hodnocení."
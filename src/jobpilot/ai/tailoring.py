import json
import re

import httpx

from jobpilot.core.config import Settings

BANNED_TERMS = ("delve", "tapestry", "testament", "landscape", "spearhead", "synergy")
SYSTEM_PROMPT = """You are a careful CV editor. Tailor the supplied candidate profile for the supplied job.
Never invent or infer experience, employers, dates, credentials, outcomes, responsibilities, or metrics.
Keep every claim grounded in the candidate's supplied profile. Rewrite and reorder only; do not add
new facts. Skills must be selected from the candidate's existing skills. For each experience bullet,
return the source_index of the one source bullet it edits. Preserve all numeric facts from that source
bullet and never introduce a number absent from that source. Use direct, natural, concise language.
Do not use these words or phrases: delve, tapestry, testament, landscape, spearhead, synergy.
Return only a JSON object with keys: summary (string), skills (array of strings),
bullets (array of objects with source_index integer and text string), cover_letter (string).
The cover letter may use only facts from the supplied candidate profile. Say nothing when profile
evidence is missing; do not fill gaps with guesses."""


class TailoringError(RuntimeError):
    """Raised when the configured model fails or returns ungrounded output."""


class TailoringService:
    def __init__(self, settings: Settings):
        self.settings = settings

    def tailor(self, profile: dict, job: dict) -> dict:
        if not self.settings.llm_api_key:
            raise TailoringError("AI tailoring is not configured. Set LLM_API_KEY to enable it.")
        candidate = {
            "name": profile.get("name"),
            "summary": profile.get("summary", ""),
            "skills": profile.get("skills", []),
            "experience": profile.get("experience", []),
            "education": profile.get("education", []),
            "projects": profile.get("projects", []),
            "source_bullets": [*profile.get("experience", []), *profile.get("projects", [])],
        }
        payload = {
            "model": self.settings.llm_model,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps({"candidate": candidate, "job": job}, ensure_ascii=False)},
            ],
        }
        try:
            response = httpx.post(
                self.settings.llm_base_url.rstrip("/") + "/chat/completions",
                headers={"Authorization": f"Bearer {self.settings.llm_api_key}"},
                json=payload,
                timeout=60,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            result = json.loads(content)
        except (httpx.HTTPError, KeyError, IndexError, json.JSONDecodeError, TypeError) as exc:
            raise TailoringError("The AI provider failed to return a valid tailoring response.") from exc
        return self._validate(result, candidate)

    def _validate(self, result: object, candidate: dict) -> dict:
        if not isinstance(result, dict):
            raise TailoringError("The AI response was not a JSON object.")
        summary = _plain_string(result.get("summary"), 3000)
        cover_letter = _plain_string(result.get("cover_letter"), 6000)
        allowed_skills = {str(skill).casefold(): str(skill) for skill in candidate["skills"]}
        skills_in = result.get("skills", [])
        if not isinstance(skills_in, list):
            raise TailoringError("AI returned an invalid skills list.")
        skills = [allowed_skills[str(skill).casefold()] for skill in skills_in if str(skill).casefold() in allowed_skills]
        source_bullets = [*candidate["experience"], *candidate["projects"]]
        bullets_in = result.get("bullets", [])
        if not isinstance(bullets_in, list):
            raise TailoringError("AI returned invalid experience bullets.")
        bullets = []
        for item in bullets_in:
            if not isinstance(item, dict) or not isinstance(item.get("source_index"), int):
                continue
            index = item["source_index"]
            if index < 0 or index >= len(source_bullets):
                continue
            text = _plain_string(item.get("text"), 1200)
            original_numbers = set(re.findall(r"\b\d[\d,.%+-]*\b", source_bullets[index]))
            output_numbers = set(re.findall(r"\b\d[\d,.%+-]*\b", text))
            if output_numbers - original_numbers:
                raise TailoringError("AI output introduced a numeric claim absent from its source bullet. Please retry.")
            bullets.append({"source_index": index, "text": text, "source_text": source_bullets[index]})
        all_text = " ".join([summary, cover_letter, *(item["text"] for item in bullets)]).casefold()
        if any(term in all_text for term in BANNED_TERMS):
            raise TailoringError("AI output contained a blocked phrase. Please retry.")
        source_numbers = set(re.findall(r"\b\d[\d,.%+-]*\b", json.dumps(candidate)))
        generated_numbers = set(re.findall(r"\b\d[\d,.%+-]*\b", summary + " " + cover_letter))
        if generated_numbers - source_numbers:
            raise TailoringError("AI output introduced a numeric claim absent from the candidate profile. Please retry.")
        return {
            "summary": summary,
            "skills": skills,
            "bullets": bullets,
            "cover_letter": cover_letter,
            "review_required": True,
            "grounding_note": "Review every line before using it. AI output can still misstate source material.",
        }


def _plain_string(value: object, max_length: int) -> str:
    if not isinstance(value, str):
        raise TailoringError("AI returned a field with an invalid format.")
    text = re.sub(r"\s+", " ", value).strip()
    if len(text) > max_length:
        raise TailoringError("AI returned text longer than the allowed limit.")
    return text

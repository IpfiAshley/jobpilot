import re
from collections.abc import Iterable

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


def match_cv_to_job(profile: dict, job_description: str, *, job_title: str = "", top_n: int = 30) -> dict:
    """Return a bounded similarity score and job terms absent from the candidate text.

    Score combines TF-IDF cosine similarity with keyword coverage; it is a ranking aid,
    not a probability of interview or employment.
    """
    cv_text = _profile_text(profile)
    job_text = re.sub(r"\s+", " ", f"{job_title} {job_description}").strip()
    if not cv_text or not job_text:
        return {"score": 0, "cosine_similarity": 0.0, "keyword_coverage": 0.0, "missing_keywords": []}
    try:
        matrix = TfidfVectorizer(ngram_range=(1, 2), stop_words="english", max_features=20_000).fit_transform([cv_text, job_text])
        similarity = float(cosine_similarity(matrix[0:1], matrix[1:2])[0, 0])
    except ValueError:
        similarity = 0.0
    job_terms = _important_terms(job_text)
    cv_tokens = _tokens(cv_text)
    matched = [term for term in job_terms if term in cv_tokens or all(part in cv_tokens for part in term.split())]
    coverage = len(matched) / len(job_terms) if job_terms else 0.0
    score = round(100 * (0.65 * similarity + 0.35 * coverage))
    missing = [term for term in job_terms if term not in matched][:top_n]
    return {
        "score": max(0, min(100, score)),
        "cosine_similarity": round(similarity, 4),
        "keyword_coverage": round(coverage, 4),
        "matched_keywords": matched[:top_n],
        "missing_keywords": missing,
        "disclaimer": "Similarity ranking only; validate required skills and CV extraction manually.",
    }


def _profile_text(profile: dict) -> str:
    values: list[str] = []
    for key in ("summary", "skills", "experience", "education", "projects", "raw_text"):
        value = profile.get(key, "")
        if isinstance(value, str):
            values.append(value)
        elif isinstance(value, Iterable):
            values.extend(str(item) for item in value)
    return re.sub(r"\s+", " ", " ".join(values)).strip()


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9+#.]+", text.lower()))


def _important_terms(text: str) -> list[str]:
    vectorizer = TfidfVectorizer(ngram_range=(1, 2), stop_words="english", max_features=250)
    try:
        matrix = vectorizer.fit_transform([text])
        terms = vectorizer.get_feature_names_out()
        weights = matrix.toarray()[0]
        ordered = sorted(zip(terms, weights, strict=True), key=lambda pair: pair[1], reverse=True)
        return [term for term, weight in ordered[:80] if weight > 0]
    except ValueError:
        return []

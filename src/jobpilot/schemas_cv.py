from pydantic import BaseModel, Field


class MatchRequest(BaseModel):
    profile: dict
    job_description: str = Field(max_length=50_000)
    job_title: str = Field(default="", max_length=300)


class TailorRequest(BaseModel):
    profile: dict
    job_title: str = Field(max_length=300)
    company: str = Field(default="", max_length=300)
    job_description: str = Field(max_length=50_000)


class ExportRequest(BaseModel):
    profile: dict
    job_title: str = Field(max_length=300)
    company: str = Field(default="", max_length=300)
    tailored: dict
    format: str = Field(pattern="^(docx|pdf)$")

from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import List, Optional
import enum

# ---------- Survey Schemas ----------
class SurveyBase(BaseModel):
    title: str

class SurveyCreate(SurveyBase):
    pass  # only title needed to create

class SurveyUpdate(BaseModel):
    title: Optional[str] = None
    is_active: Optional[bool] = None

class SurveyResponse(SurveyBase):
    id: int
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class SurveyDetailResponse(SurveyResponse):
    questions: List["SurveyQuestionResponse"] = []

# ---------- SurveyQuestion Schemas ----------
class SurveyQuestionBase(BaseModel):
    question_text: str
    order: int

class SurveyQuestionCreate(SurveyQuestionBase):
    pass

class SurveyQuestionResponse(SurveyQuestionBase):
    id: int
    survey_id: int

    model_config = ConfigDict(from_attributes=True)

# This resolves the forward reference in SurveyDetailResponse
SurveyDetailResponse.model_rebuild()

# ---------- Submission Schemas ----------
class SubmissionStartResponse(BaseModel):
    submission_id: int
    survey_id: int
    started_at: datetime

    model_config = ConfigDict(from_attributes=True)

class AnswerSubmit(BaseModel):
    question_id: int
    answer: str  # "Yes" or "No"
    face_detected: bool
    face_score: float  # 0-100
    # face image will be uploaded separately via /media endpoint

class AnswerResponse(BaseModel):
    id: int
    submission_id: int
    question_id: int
    answer: str
    face_detected: bool
    face_score: Optional[float]
    face_image_path: Optional[str]

    model_config = ConfigDict(from_attributes=True)

class SubmissionCompleteResponse(BaseModel):
    submission_id: int
    completed_at: datetime
    overall_score: float

    model_config = ConfigDict(from_attributes=True)

class MediaTypeEnum(str, enum.Enum):
    video = "video"
    image = "image"

class MediaUploadResponse(BaseModel):
    id: int
    submission_id: int
    type: str
    path: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, Float, Enum
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from .database import Base   # <-- THIS IS REQUIRED
import enum

# Enums for type safety
class MediaType(str, enum.Enum):
    video = "video"
    image = "image"

class AnswerChoice(str, enum.Enum):
    yes = "Yes"
    no = "No"

# Survey Table
class Survey(Base):
    __tablename__ = "surveys"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    questions = relationship("SurveyQuestion", back_populates="survey", cascade="all, delete-orphan")
    submissions = relationship("SurveySubmission", back_populates="survey")

# SurveyQuestion Table
class SurveyQuestion(Base):
    __tablename__ = "survey_questions"

    id = Column(Integer, primary_key=True, index=True)
    survey_id = Column(Integer, ForeignKey("surveys.id", ondelete="CASCADE"), nullable=False)
    question_text = Column(Text, nullable=False)
    order = Column(Integer, nullable=False)

    survey = relationship("Survey", back_populates="questions")
    answers = relationship("SurveyAnswer", back_populates="question")

# SurveySubmission Table
class SurveySubmission(Base):
    __tablename__ = "survey_submissions"

    id = Column(Integer, primary_key=True, index=True)
    survey_id = Column(Integer, ForeignKey("surveys.id", ondelete="CASCADE"), nullable=False)
    ip_address = Column(String(45), nullable=False)
    device = Column(String(50))
    browser = Column(String(50))
    os = Column(String(50))
    location = Column(String(100))
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    overall_score = Column(Float, nullable=True)

    survey = relationship("Survey", back_populates="submissions")
    answers = relationship("SurveyAnswer", back_populates="submission", cascade="all, delete-orphan")
    media_files = relationship("MediaFile", back_populates="submission", cascade="all, delete-orphan")

    @property
    def answer_count(self) -> int:
        return len(self.answers)

# SurveyAnswer Table
class SurveyAnswer(Base):
    __tablename__ = "survey_answers"

    id = Column(Integer, primary_key=True, index=True)
    submission_id = Column(Integer, ForeignKey("survey_submissions.id", ondelete="CASCADE"), nullable=False)
    question_id = Column(Integer, ForeignKey("survey_questions.id", ondelete="CASCADE"), nullable=False)
    answer = Column(Enum(AnswerChoice), nullable=False)
    face_detected = Column(Boolean, default=False)
    face_score = Column(Float, nullable=True)
    face_image_path = Column(String(500), nullable=True)

    submission = relationship("SurveySubmission", back_populates="answers")
    question = relationship("SurveyQuestion", back_populates="answers")

# MediaFile Table
class MediaFile(Base):
    __tablename__ = "media_files"

    id = Column(Integer, primary_key=True, index=True)
    submission_id = Column(Integer, ForeignKey("survey_submissions.id", ondelete="CASCADE"), nullable=False)
    type = Column(Enum(MediaType), nullable=False)
    path = Column(String(500), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    submission = relationship("SurveySubmission", back_populates="media_files")
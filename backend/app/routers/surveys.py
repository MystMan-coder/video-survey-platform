from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from .. import schemas, crud
from ..database import get_db

router = APIRouter(prefix="/api/surveys", tags=["surveys"])

@router.post("", response_model=schemas.SurveyResponse, status_code=status.HTTP_201_CREATED)
def create_survey(survey: schemas.SurveyCreate, db: Session = Depends(get_db)):
    """Create a new survey (draft)."""
    return crud.create_survey(db, survey)

@router.get("/{survey_id}", response_model=schemas.SurveyDetailResponse)
def get_survey(survey_id: int, db: Session = Depends(get_db)):
    """Get a survey with all its questions."""
    db_survey = crud.get_survey_with_questions(db, survey_id)
    if not db_survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    return db_survey

@router.post("/{survey_id}/questions", response_model=schemas.SurveyQuestionResponse, status_code=status.HTTP_201_CREATED)
def add_question(survey_id: int, question: schemas.SurveyQuestionCreate, db: Session = Depends(get_db)):
    """Add a question to a survey."""
    # Verify survey exists
    survey = crud.get_survey(db, survey_id)
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    
    # Optional: Enforce exactly 5 questions (we can check and limit)
    existing = crud.get_questions_for_survey(db, survey_id)
    if len(existing) >= 5:
        raise HTTPException(status_code=400, detail="Survey already has 5 questions (maximum allowed)")
    
    # Ensure order is unique (basic check)
    for q in existing:
        if q.order == question.order:
            raise HTTPException(status_code=400, detail=f"Question with order {question.order} already exists")
    
    return crud.create_question(db, survey_id, question)

@router.post("/{survey_id}/publish", response_model=schemas.SurveyResponse)
def publish_survey(survey_id: int, db: Session = Depends(get_db)):
    """Publish a survey (set is_active=True)."""
    survey = crud.get_survey(db, survey_id)
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    
    # Check if survey has exactly 5 questions
    question_count = len(survey.questions)
    if question_count != 5:
        raise HTTPException(
            status_code=400,
            detail=f"Survey must have exactly 5 questions before publishing. Currently has {question_count}."
        )
    
    updates = schemas.SurveyUpdate(is_active=True)
    return crud.update_survey(db, survey_id, updates)
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from .. import schemas, crud, models
from ..database import get_db

router = APIRouter(prefix="/api/surveys", tags=["surveys"])


@router.post("", response_model=schemas.SurveyResponse, status_code=status.HTTP_201_CREATED)
def create_survey(survey: schemas.SurveyCreate, db: Session = Depends(get_db)):
    """Create a new survey (draft)."""
    return crud.create_survey(db, survey)


@router.get("", response_model=List[schemas.SurveyResponse])
def list_surveys(db: Session = Depends(get_db)):
    """List all surveys."""
    surveys = db.query(models.Survey).order_by(models.Survey.created_at.desc()).all()
    return surveys


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
    survey = crud.get_survey(db, survey_id)
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")

    existing = crud.get_questions_for_survey(db, survey_id)

    # Check for duplicate order
    for q in existing:
        if q.order == question.order:
            raise HTTPException(status_code=400, detail=f"Question with order {question.order} already exists in this survey")

    # Check maximum questions
    if len(existing) >= 5:
        raise HTTPException(status_code=400, detail="Survey already has 5 questions (maximum allowed)")

    return crud.create_question(db, survey_id, question)


# @router.put("/questions/{question_id}", response_model=schemas.SurveyQuestionResponse)
# def update_question(question_id: int, question_update: schemas.SurveyQuestionCreate, db: Session = Depends(get_db)):
#     """Update an existing question (by global question_id)."""
#     db_question = db.query(models.SurveyQuestion).filter(models.SurveyQuestion.id == question_id).first()
#     if not db_question:
#         raise HTTPException(status_code=404, detail="Question not found")

#     # Check for duplicate order in the same survey (excluding this question)
#     existing = crud.get_questions_for_survey(db, db_question.survey_id)
#     for q in existing:
#         if q.id != question_id and q.order == question_update.order:
#             raise HTTPException(status_code=400, detail=f"Order {question_update.order} is already used by another question in this survey")

#     db_question.question_text = question_update.question_text
#     db_question.order = question_update.order
#     db.commit()
#     db.refresh(db_question)
#     return db_question


# @router.delete("/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
# def delete_question(question_id: int, db: Session = Depends(get_db)):
#     """Delete a question (by global question_id)."""
#     db_question = db.query(models.SurveyQuestion).filter(models.SurveyQuestion.id == question_id).first()
#     if not db_question:
#         raise HTTPException(status_code=404, detail="Question not found")
#     db.delete(db_question)
#     db.commit()
#     return


@router.put("/{survey_id}/questions/{order}", response_model=schemas.SurveyQuestionResponse)
def update_question_by_order(
    survey_id: int,
    order: int,
    question_update: schemas.SurveyQuestionCreate,
    db: Session = Depends(get_db)
):
    """Update a question by survey ID and question order (1-5)."""
    question = db.query(models.SurveyQuestion).filter(
        models.SurveyQuestion.survey_id == survey_id,
        models.SurveyQuestion.order == order
    ).first()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    # If the order is being changed, check for duplicates
    if order != question_update.order:
        existing = crud.get_questions_for_survey(db, survey_id)
        for q in existing:
            if q.id != question.id and q.order == question_update.order:
                raise HTTPException(
                    status_code=400,
                    detail=f"Order {question_update.order} is already used by another question in this survey"
                )

    question.question_text = question_update.question_text
    question.order = question_update.order
    db.commit()
    db.refresh(question)
    return question


@router.delete("/{survey_id}/questions/{order}", status_code=status.HTTP_204_NO_CONTENT)
def delete_question_by_order(survey_id: int, order: int, db: Session = Depends(get_db)):
    """Delete a question by survey ID and question order (1-5)."""
    question = db.query(models.SurveyQuestion).filter(
        models.SurveyQuestion.survey_id == survey_id,
        models.SurveyQuestion.order == order
    ).first()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    db.delete(question)
    db.commit()
    return


@router.post("/{survey_id}/publish", response_model=schemas.SurveyResponse)
def publish_survey(survey_id: int, db: Session = Depends(get_db)):
    """Publish a survey (set is_active=True)."""
    survey = crud.get_survey(db, survey_id)
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")

    if survey.is_active:
        raise HTTPException(status_code=400, detail="Survey is already published")

    question_count = len(survey.questions)
    if question_count != 5:
        raise HTTPException(
            status_code=400,
            detail=f"Survey must have exactly 5 questions before publishing. Currently has {question_count}."
        )

    updates = schemas.SurveyUpdate(is_active=True)
    return crud.update_survey(db, survey_id, updates)


@router.post("/{survey_id}/unpublish", response_model=schemas.SurveyResponse)
def unpublish_survey(survey_id: int, db: Session = Depends(get_db)):
    """Unpublish a survey (set is_active=False)."""
    survey = crud.get_survey(db, survey_id)
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")

    if not survey.is_active:
        raise HTTPException(status_code=400, detail="Survey is already unpublished")

    updates = schemas.SurveyUpdate(is_active=False)
    return crud.update_survey(db, survey_id, updates)

@router.delete("/{survey_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_survey_endpoint(survey_id: int, db: Session = Depends(get_db)):
    """Delete a survey. Fails if the survey is currently published."""
    survey = crud.get_survey(db, survey_id)
    
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")

    # Extra backend protection: Prevent deleting published surveys
    if survey.is_active:
        raise HTTPException(
            status_code=400, 
            detail="Cannot delete a published survey. Please unpublish it first."
        )

    crud.delete_survey(db, survey_id)
    return
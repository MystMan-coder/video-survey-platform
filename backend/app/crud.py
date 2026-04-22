from sqlalchemy.orm import Session
from . import models, schemas
from datetime import datetime

# ---------- Survey CRUD ----------
def create_survey(db: Session, survey_data: schemas.SurveyCreate) -> models.Survey:
    db_survey = models.Survey(title=survey_data.title)
    db.add(db_survey)
    db.commit()
    db.refresh(db_survey)
    return db_survey

def get_survey(db: Session, survey_id: int) -> models.Survey | None:
    return db.query(models.Survey).filter(models.Survey.id == survey_id).first()

def get_survey_with_questions(db: Session, survey_id: int) -> models.Survey | None:
    return db.query(models.Survey).filter(models.Survey.id == survey_id).first()

def update_survey(db: Session, survey_id: int, updates: schemas.SurveyUpdate) -> models.Survey | None:
    db_survey = get_survey(db, survey_id)
    if not db_survey:
        return None
    update_data = updates.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_survey, field, value)
    db.commit()
    db.refresh(db_survey)
    return db_survey

# ---------- SurveyQuestion CRUD ----------
def create_question(db: Session, survey_id: int, question_data: schemas.SurveyQuestionCreate) -> models.SurveyQuestion:
    db_question = models.SurveyQuestion(
        survey_id=survey_id,
        question_text=question_data.question_text,
        order=question_data.order
    )
    db.add(db_question)
    db.commit()
    db.refresh(db_question)
    return db_question

def get_questions_for_survey(db: Session, survey_id: int) -> list[models.SurveyQuestion]:
    return db.query(models.SurveyQuestion).filter(
        models.SurveyQuestion.survey_id == survey_id
    ).order_by(models.SurveyQuestion.order).all()

def delete_all_questions(db: Session, survey_id: int) -> None:
    db.query(models.SurveyQuestion).filter(
        models.SurveyQuestion.survey_id == survey_id
    ).delete()
    db.commit()


# ---------- Submission CRUD ----------
def create_submission(db: Session, survey_id: int, metadata: dict) -> models.SurveySubmission:
    db_submission = models.SurveySubmission(
        survey_id=survey_id,
        ip_address=metadata["ip_address"],
        device=metadata["device"],
        browser=metadata["browser"],
        os=metadata["os"],
        location=metadata["location"],
    )
    db.add(db_submission)
    db.commit()
    db.refresh(db_submission)
    return db_submission

def get_submission(db: Session, submission_id: int) -> models.SurveySubmission | None:
    return db.query(models.SurveySubmission).filter(models.SurveySubmission.id == submission_id).first()

def create_answer(db: Session, submission_id: int, answer_data: schemas.AnswerSubmit) -> models.SurveyAnswer:
    db_answer = models.SurveyAnswer(
        submission_id=submission_id,
        question_id=answer_data.question_id,
        answer=answer_data.answer,
        face_detected=answer_data.face_detected,
        face_score=answer_data.face_score,
    )
    db.add(db_answer)
    db.commit()
    db.refresh(db_answer)
    return db_answer

def update_answer_face_image(db: Session, answer_id: int, image_path: str) -> models.SurveyAnswer | None:
    db_answer = db.query(models.SurveyAnswer).filter(models.SurveyAnswer.id == answer_id).first()
    if db_answer:
        db_answer.face_image_path = image_path
        db.commit()
        db.refresh(db_answer)
    return db_answer

def create_media_file(db: Session, submission_id: int, media_type: str, file_path: str) -> models.MediaFile:
    db_media = models.MediaFile(
        submission_id=submission_id,
        type=media_type,
        path=file_path,
    )
    db.add(db_media)
    db.commit()
    db.refresh(db_media)
    return db_media

def complete_submission(db: Session, submission_id: int) -> models.SurveySubmission | None:
    db_submission = get_submission(db, submission_id)
    if not db_submission:
        return None
    
    # Calculate overall_score = average of all face_scores
    answers = db_submission.answers
    if answers:
        scores = [a.face_score for a in answers if a.face_score is not None]
        overall = sum(scores) / len(scores) if scores else 0.0
    else:
        overall = 0.0
    
    db_submission.completed_at = datetime.utcnow()
    db_submission.overall_score = overall
    db.commit()
    db.refresh(db_submission)
    return db_submission
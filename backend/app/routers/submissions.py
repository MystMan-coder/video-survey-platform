from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form, status
from sqlalchemy.orm import Session
import shutil
from pathlib import Path
from typing import Optional, List

from .. import schemas, crud, models
from ..database import get_db
from ..utils import get_client_ip, parse_user_agent, get_location_from_ip
from ..config import settings

router = APIRouter(prefix="/api", tags=["submissions"])


@router.post("/surveys/{survey_id}/start", response_model=schemas.SubmissionStartResponse)
def start_submission(
    survey_id: int,
    request: Request,
    db: Session = Depends(get_db)
):
    """Start a new survey submission. Captures IP and User-Agent metadata."""
    survey = crud.get_survey(db, survey_id)
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    if not survey.is_active:
        raise HTTPException(status_code=400, detail="Survey is not published yet")

    ip = get_client_ip(request)
    user_agent = request.headers.get("User-Agent", "")
    ua_info = parse_user_agent(user_agent)
    location = get_location_from_ip(ip)

    metadata = {
        "ip_address": ip,
        "device": ua_info["device"],
        "browser": ua_info["browser"],
        "os": ua_info["os"],
        "location": location,
    }

    submission = crud.create_submission(db, survey_id, metadata)
    return schemas.SubmissionStartResponse(
        submission_id=submission.id,
        survey_id=survey_id,
        started_at=submission.started_at
    )


@router.get("/submissions", response_model=List[schemas.SubmissionDetailResponse])
def list_submissions(survey_id: Optional[int] = None, db: Session = Depends(get_db)):
    """List all submissions, optionally filtered by survey."""
    query = db.query(models.SurveySubmission)
    if survey_id:
        query = query.filter(models.SurveySubmission.survey_id == survey_id)
    submissions = query.order_by(models.SurveySubmission.started_at.desc()).all()
    return submissions


@router.get("/submissions/{submission_id}", response_model=schemas.SubmissionDetailResponse)
def get_submission_details(submission_id: int, db: Session = Depends(get_db)):
    """Get a single submission with answers."""
    submission = crud.get_submission(db, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    return submission


@router.post("/submissions/{submission_id}/answers", response_model=schemas.AnswerResponse)
def submit_answer(
    submission_id: int,
    answer: schemas.AnswerSubmit,
    db: Session = Depends(get_db)
):
    """Record an answer for a specific question."""
    submission = crud.get_submission(db, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    if submission.completed_at:
        raise HTTPException(status_code=400, detail="Submission already completed")

    # Verify the question belongs to the same survey
    question = db.query(models.SurveyQuestion).filter(
        models.SurveyQuestion.id == answer.question_id,
        models.SurveyQuestion.survey_id == submission.survey_id
    ).first()
    if not question:
        raise HTTPException(status_code=400, detail="Question does not belong to this survey")

    # Check if this question has already been answered
    existing_answer = db.query(models.SurveyAnswer).filter(
        models.SurveyAnswer.submission_id == submission_id,
        models.SurveyAnswer.question_id == answer.question_id
    ).first()
    if existing_answer:
        raise HTTPException(status_code=400, detail="This question has already been answered")

    db_answer = crud.create_answer(db, submission_id, answer)
    return db_answer


@router.post("/submissions/{submission_id}/media")
async def upload_media(
    submission_id: int,
    file: UploadFile = File(...),
    media_type: schemas.MediaTypeEnum = Form(...),
    answer_id: str = Form(None),
    db: Session = Depends(get_db)
):
    """Upload a video file or a face image. Face images are linked to an answer."""
    answer_id_int = None
    if answer_id and answer_id.strip():
        try:
            answer_id_int = int(answer_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="answer_id must be an integer")

    submission = crud.get_submission(db, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

    submission_dir = Path(settings.MEDIA_ROOT) / "submissions" / str(submission_id)
    submission_dir.mkdir(parents=True, exist_ok=True)

    if media_type == schemas.MediaTypeEnum.video:
        filename = f"full_session_{submission_id}.mp4"
        file_path = submission_dir / filename
    else:
        if answer_id_int is None:
            raise HTTPException(status_code=400, detail="answer_id required for face images")
        filename = f"answer_{answer_id_int}_face.png"
        file_path = submission_dir / filename

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    relative_path = str(file_path.relative_to(settings.MEDIA_ROOT))

    if media_type == schemas.MediaTypeEnum.image and answer_id_int is not None:
        crud.update_answer_face_image(db, answer_id_int, relative_path)

    db_media = crud.create_media_file(db, submission_id, media_type.value, relative_path)
    return db_media


@router.post("/submissions/{submission_id}/complete", response_model=schemas.SubmissionCompleteResponse)
def complete_submission(submission_id: int, db: Session = Depends(get_db)):
    """Mark submission as complete and calculate overall face score."""
    submission = crud.get_submission(db, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    if submission.completed_at:
        raise HTTPException(status_code=400, detail="Submission already completed")

    # Must have exactly 5 answers
    if len(submission.answers) != 5:
        raise HTTPException(status_code=400, detail="All 5 questions must be answered before completion")

    # Verify all answers belong to this survey
    survey_question_ids = {q.id for q in submission.survey.questions}
    for answer in submission.answers:
        if answer.question_id not in survey_question_ids:
            raise HTTPException(
                status_code=400,
                detail=f"Answer references question {answer.question_id} which does not belong to this survey"
            )

    updated = crud.complete_submission(db, submission_id)
    return schemas.SubmissionCompleteResponse(
        submission_id=submission_id,
        completed_at=updated.completed_at,
        overall_score=updated.overall_score
    )
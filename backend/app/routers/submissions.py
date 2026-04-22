from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form, status
from sqlalchemy.orm import Session
import os
import shutil
from pathlib import Path

from .. import schemas, crud
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
    # Verify survey exists and is active
    survey = crud.get_survey(db, survey_id)
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    if not survey.is_active:
        raise HTTPException(status_code=400, detail="Survey is not published yet")
    
    # Capture metadata
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
    
    # Optional: verify question belongs to the same survey
    # (skipped for brevity, but good to add)
    
    db_answer = crud.create_answer(db, submission_id, answer)
    return db_answer

@router.post("/submissions/{submission_id}/media")
async def upload_media(
    submission_id: int,
    file: UploadFile = File(...),
    media_type: schemas.MediaTypeEnum = Form(...),
    answer_id: str = Form(None),  # optional, only for face images
    db: Session = Depends(get_db)
):
    """Upload a video file or a face image. Face images are linked to an answer."""
    
    # Convert answer_id from string to int, handling empty/missing
    answer_id_int = None
    if answer_id and answer_id.strip():
        try:
            answer_id_int = int(answer_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="answer_id must be an integer")
    
    submission = crud.get_submission(db, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    
    # Create directory: media/submissions/{submission_id}/
    submission_dir = Path(settings.MEDIA_ROOT) / "submissions" / str(submission_id)
    submission_dir.mkdir(parents=True, exist_ok=True)
    
    # Determine file path
    if media_type == schemas.MediaTypeEnum.video:
        filename = f"full_session_{submission_id}.mp4"
        file_path = submission_dir / filename
    else:  # image
        if answer_id_int is None:
            raise HTTPException(status_code=400, detail="answer_id required for face images")
        filename = f"answer_{answer_id_int}_face.png"
        file_path = submission_dir / filename
    
    # Save file
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # Store relative path in DB
    relative_path = str(file_path.relative_to(settings.MEDIA_ROOT))
    
    # If it's a face image, update the answer record with the path
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
    
    # Check if all 5 questions have answers
    if len(submission.answers) != 5:
        raise HTTPException(status_code=400, detail="All 5 questions must be answered before completion")
    
    updated = crud.complete_submission(db, submission_id)
    return schemas.SubmissionCompleteResponse(
        submission_id=submission_id,
        completed_at=updated.completed_at,
        overall_score=updated.overall_score
    )
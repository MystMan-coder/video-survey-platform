from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
import shutil
import zipfile
import io
import json
from pathlib import Path
from datetime import datetime
from typing import Optional, List

from .. import schemas, crud, models
from ..database import get_db
from ..utils import get_client_ip, parse_user_agent, get_location_from_ip
from ..config import settings

# submission export + media upload live here
export_router = APIRouter(prefix="/submissions", tags=["export"])

def json_serial(obj):
    # fallback serializer for datetime fields
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"Type {type(obj)} not serializable")

@export_router.get("/{submission_id}/export")
async def export_submission(submission_id: int, db: Session = Depends(get_db)):
    """Export submission data and media files as a ZIP archive."""
    submission = crud.get_submission(db, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    if not submission.completed_at:
        raise HTTPException(status_code=400, detail="Submission not completed yet")

    answers = submission.answers
    questions_map = {q.id: q for q in submission.survey.questions}

    responses = []
    for answer in sorted(answers, key=lambda a: questions_map.get(a.question_id).order if questions_map.get(a.question_id) else 999):
        q = questions_map.get(answer.question_id)
        order = q.order if q else "?"
        responses.append({
            "question": q.question_text if q else "Unknown",
            "answer": answer.answer.value if answer.answer else "",
            "face_detected": answer.face_detected,
            "score": answer.face_score,
            # Use ZIP-relative path as per assignment spec
            "face_image": f"/images/q{order}_face.png" if answer.face_image_path else None
        })

    def fmt_dt(dt):
        if dt is None:
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    metadata = {
        "submission_id": str(submission.id),
        "survey_id": str(submission.survey_id),
        "started_at": fmt_dt(submission.started_at),
        "completed_at": fmt_dt(submission.completed_at),
        "ip_address": submission.ip_address,
        "device": submission.device,
        "browser": submission.browser,
        "os": submission.os,
        "location": submission.location,
        "responses": responses,
        "overall_score": submission.overall_score
    }

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("metadata.json", json.dumps(metadata, indent=2, default=json_serial))
        media_root = Path(settings.MEDIA_ROOT)
        
        # Only grab the video file here to prevent duplicate images in the ZIP
        for media in submission.media_files:
            file_path = media_root / media.path
            if file_path.exists() and media.type == models.MediaType.video:
                arcname = "videos/full_session.mp4"
                zf.write(file_path, arcname=arcname)
                
        # Grab the images and name them sequentially based on question order
        for answer in answers:
            if answer.face_image_path:
                img_path = media_root / answer.face_image_path
                if img_path.exists():
                    q = questions_map.get(answer.question_id)
                    order = q.order if q else answer.question_id
                    arcname = f"images/q{order}_face.png"
                    zf.write(img_path, arcname=arcname)

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=submission_{submission_id}_export.zip"}
    )

# --- SUBMISSIONS ENDPOINTS ---
router = APIRouter(prefix="/api", tags=["submissions"])
router.include_router(export_router)

@router.post("/surveys/{survey_id}/start", response_model=schemas.SubmissionStartResponse)
def start_submission(survey_id: int, request: Request, db: Session = Depends(get_db)):
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
    query = db.query(models.SurveySubmission).options(
        joinedload(models.SurveySubmission.answers),
        joinedload(models.SurveySubmission.media_files)
    )
    if survey_id:
        query = query.filter(models.SurveySubmission.survey_id == survey_id)
    submissions = query.order_by(models.SurveySubmission.started_at.desc()).all()
    return submissions

@router.get("/submissions/{submission_id}", response_model=schemas.SubmissionDetailResponse)
def get_submission_details(submission_id: int, db: Session = Depends(get_db)):
    """Get a single submission with answers."""
    submission = db.query(models.SurveySubmission).options(
        joinedload(models.SurveySubmission.answers),
        joinedload(models.SurveySubmission.media_files)
    ).filter(models.SurveySubmission.id == submission_id).first()
    
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    return submission

@router.post("/submissions/{submission_id}/answers", response_model=schemas.AnswerResponse)
def submit_answer(submission_id: int, answer: schemas.AnswerSubmit, db: Session = Depends(get_db)):
    """Record an answer for a specific question."""
    submission = crud.get_submission(db, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    if submission.completed_at:
        raise HTTPException(status_code=400, detail="Submission already completed")

    question = db.query(models.SurveyQuestion).filter(
        models.SurveyQuestion.id == answer.question_id,
        models.SurveyQuestion.survey_id == submission.survey_id
    ).first()
    if not question:
        raise HTTPException(status_code=400, detail="Question does not belong to this survey")

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

    if len(submission.answers) != 5:
        raise HTTPException(status_code=400, detail="All 5 questions must be answered before completion")

    survey_question_ids = {q.id for q in submission.survey.questions}
    for answer in submission.answers:
        if answer.question_id not in survey_question_ids:
            raise HTTPException(status_code=400, detail="Answer references invalid question")

    updated = crud.complete_submission(db, submission_id)
    return schemas.SubmissionCompleteResponse(
        submission_id=submission_id,
        completed_at=updated.completed_at,
        overall_score=updated.overall_score
    )
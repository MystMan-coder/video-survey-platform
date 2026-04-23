from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import zipfile
import io
import json
from pathlib import Path
from datetime import datetime

from ..database import get_db
from .. import crud, models
from ..config import settings

router = APIRouter(prefix="/api/submissions", tags=["export"])


def json_serial(obj):
    """JSON serializer for objects not serializable by default json code"""
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"Type {type(obj)} not serializable")


@router.get("/{submission_id}/export")
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
    for answer in answers:
        q = questions_map.get(answer.question_id)
        responses.append({
            "question": q.question_text if q else "Unknown",
            "answer": answer.answer.value if answer.answer else "",
            "face_detected": answer.face_detected,
            "score": answer.face_score,
            "face_image": answer.face_image_path if answer.face_image_path else None
        })

    responses.sort(key=lambda r: next((q.order for q in submission.survey.questions if q.question_text == r["question"]), 999))

    metadata = {
        "submission_id": str(submission.id),
        "survey_id": str(submission.survey_id),
        "started_at": submission.started_at,
        "completed_at": submission.completed_at,
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
        for media in submission.media_files:
            file_path = media_root / media.path
            if file_path.exists():
                if media.type == models.MediaType.video:
                    arcname = "videos/full_session.mp4"
                else:
                    arcname = f"images/{file_path.name}"
                zf.write(file_path, arcname=arcname)
            else:
                print(f"Warning: Media file not found: {file_path}")

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
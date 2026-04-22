from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import zipfile
import io
import json
import os
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
    
    # Gather metadata
    answers = submission.answers
    # Sort answers by question order (we need to fetch questions to know order)
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
    
    # Sort by question order (assuming order matches insertion)
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
    
    # Create in-memory ZIP file
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        # Add metadata.json
        zf.writestr("metadata.json", json.dumps(metadata, indent=2, default=json_serial))
        
        # Add media files
        media_root = Path(settings.MEDIA_ROOT)
        for media in submission.media_files:
            file_path = media_root / media.path
            if file_path.exists():
                # Determine archive path: videos/full_session.mp4 or images/q1_face.png
                if media.type == models.MediaType.video:
                    arcname = "videos/full_session.mp4"
                else:
                    # Try to extract question order from filename (answer_X_face.png)
                    # Better: we can match with answer
                    # For simplicity, use original filename
                    arcname = f"images/{file_path.name}"
                zf.write(file_path, arcname=arcname)
            else:
                print(f"Warning: Media file not found: {file_path}")
        
        # Also include face images that are referenced in answers but not in media_files table
        for answer in answers:
            if answer.face_image_path:
                img_path = media_root / answer.face_image_path
                if img_path.exists():
                    # Determine question order for naming
                    q = questions_map.get(answer.question_id)
                    order = q.order if q else answer.question_id
                    arcname = f"images/q{order}_face.png"
                    # Avoid duplicate if already added via media_files
                    # (zipfile will overwrite, which is fine)
                    zf.write(img_path, arcname=arcname)
    
    zip_buffer.seek(0)
    
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=submission_{submission_id}_export.zip"}
    )
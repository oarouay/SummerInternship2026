import os
import re
import uuid
from typing import Optional, Tuple
import anyio
from fastapi import HTTPException, UploadFile, status

from app.core.config import settings


def sanitize_filename(filename: str) -> str:
    """Sanitizes the upload filename to prevent directory traversal or invalid characters."""
    # Strip any directory path components
    basename = os.path.basename(filename)
    # Remove any character that is not alphanumeric, underscore, dot, or hyphen
    sanitized = re.sub(r"[^\w\.-]", "_", basename)
    return sanitized or "unnamed_file"


def validate_file_extension(filename: str) -> str:
    """Validates that the file extension is among the allowed extensions."""
    _, ext = os.path.splitext(filename)
    ext_lower = ext.lower()
    if ext_lower not in settings.ALLOWED_EXTENSIONS:
        allowed_list = ", ".join(settings.ALLOWED_EXTENSIONS)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format '{ext}'. Allowed formats: {allowed_list}"
        )
    return ext_lower


async def save_tenant_file(tenant_id: int, file: UploadFile) -> Tuple[str, int, str]:
    """
    Saves an uploaded file into a tenant-isolated storage directory.
    
    Returns:
        tuple of (relative_file_path, file_size_bytes, original_filename)
    Raises:
        HTTPException: If file type is unsupported or exceeds max upload size.
    """
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file must have a valid filename."
        )

    # 1. Validate file extension
    validate_file_extension(file.filename)
    safe_name = sanitize_filename(file.filename)

    # 2. Ensure tenant directory exists
    tenant_dir = os.path.join(settings.UPLOAD_DIR, str(tenant_id))
    os.makedirs(tenant_dir, exist_ok=True)

    # 3. Create unique file path to prevent collision
    unique_filename = f"{uuid.uuid4().hex}_{safe_name}"
    full_path = os.path.join(tenant_dir, unique_filename)

    # 4. Stream file to disk in chunks while enforcing maximum file size
    total_bytes = 0
    chunk_size = 1024 * 1024  # 1MB chunks

    try:
        async with await anyio.open_file(full_path, "wb") as out_file:
            while chunk := await file.read(chunk_size):
                total_bytes += len(chunk)
                if total_bytes > settings.MAX_UPLOAD_SIZE_BYTES:
                    max_mb = settings.MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"File exceeds maximum allowed size of {max_mb} MB."
                    )
                await out_file.write(chunk)
    except HTTPException:
        # Clean up partial file on error
        if os.path.exists(full_path):
            os.remove(full_path)
        raise
    except Exception as e:
        if os.path.exists(full_path):
            os.remove(full_path)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save file: {str(e)}"
        )

    # Return relative path for database storage
    relative_path = os.path.relpath(full_path).replace("\\", "/")
    return relative_path, total_bytes, safe_name


def delete_tenant_file(file_path: Optional[str]) -> bool:
    """Removes a file from disk if it exists."""
    if not file_path:
        return False
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
            return True
    except OSError:
        pass
    return False

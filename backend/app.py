from __future__ import annotations

import hashlib
import mimetypes
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4
from datetime import datetime, timezone

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import firebase_admin
from firebase_admin import auth as admin_auth, credentials, firestore
from werkzeug.utils import secure_filename

load_dotenv()


def _init_firebase() -> firestore.Client:
    project_id = os.getenv("FIREBASE_PROJECT_ID")
    client_email = os.getenv("FIREBASE_CLIENT_EMAIL")
    private_key = (os.getenv("FIREBASE_PRIVATE_KEY") or "").replace("\\n", "\n")
    service_account_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")

    if not firebase_admin._apps:
        if service_account_json:
            cred = credentials.Certificate(service_account_json)
            firebase_admin.initialize_app(cred)
        elif project_id and client_email and private_key:
            cred = credentials.Certificate(
                {
                    "type": "service_account",
                    "project_id": project_id,
                    "client_email": client_email,
                    "private_key": private_key,
                    "token_uri": "https://oauth2.googleapis.com/token",
                }
            )
            firebase_admin.initialize_app(cred)
        else:
            # Fallback to Application Default Credentials if available on the machine.
            try:
                firebase_admin.initialize_app()
            except Exception as exc:
                raise RuntimeError(
                    "Missing Firebase Admin credentials. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY, or configure Application Default Credentials."
                ) from exc

    return firestore.client()


def _normalize_districts(raw: Any) -> list[str]:
    if isinstance(raw, list):
        values = [str(item).strip() for item in raw]
    elif isinstance(raw, str):
        values = [item.strip() for item in raw.split(",")]
    else:
        values = []

    unique = sorted({item for item in values if item})
    return unique


def create_app() -> Flask:
    app = Flask(__name__)
    frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
    CORS(app, resources={r"/api/*": {"origins": [frontend_origin]}})
    app.config["MAX_CONTENT_LENGTH"] = 80 * 1024 * 1024

    uploads_root = Path(__file__).resolve().parent / "uploads"
    uploads_root.mkdir(parents=True, exist_ok=True)

    def _to_local_upload_path(value: str) -> Path | None:
      raw = str(value or "").strip()
      if not raw:
          return None

      # Accept either backend URL (/uploads/...) or relative upload path (owner/file.pdf).
      if raw.startswith("http://") or raw.startswith("https://"):
          parsed = urlparse(raw)
          path_part = parsed.path
          if "/uploads/" not in path_part:
              return None
          relative = path_part.split("/uploads/", 1)[1]
      else:
          relative = raw.replace("\\", "/").lstrip("/")
          if relative.startswith("uploads/"):
              relative = relative.split("uploads/", 1)[1]

      candidate = (uploads_root / relative).resolve()
      if uploads_root not in candidate.parents and candidate != uploads_root:
          return None

      return candidate

    def _analyze_pdf(path: Path) -> dict[str, Any]:
      stat = path.stat()
      guessed_type, _ = mimetypes.guess_type(str(path))
      sha256 = hashlib.sha256(path.read_bytes()).hexdigest()

      result: dict[str, Any] = {
          "exists": True,
          "name": path.name,
          "path": str(path),
          "sizeBytes": stat.st_size,
          "mimeType": guessed_type or "application/pdf",
          "sha256": sha256,
          "isPdfExtension": path.suffix.lower() == ".pdf",
      }

      # Optional deep extraction if pypdf is installed.
      try:
          from pypdf import PdfReader  # type: ignore

          reader = PdfReader(str(path))
          result["pageCount"] = len(reader.pages)

          preview_chunks: list[str] = []
          for page in reader.pages[:2]:
              text = (page.extract_text() or "").strip()
              if text:
                  preview_chunks.append(text)

          preview_text = "\n".join(preview_chunks).strip()
          result["textPreview"] = preview_text[:1200]
      except Exception:
          result["pageCount"] = None
          result["textPreview"] = ""

      return result

    db = _init_firebase()

    def _get_authenticated_user() -> dict[str, Any] | None:
        auth_header = str(request.headers.get("Authorization") or "").strip()
        if not auth_header.startswith("Bearer "):
            return None

        token = auth_header.split(" ", 1)[1].strip()
        if not token:
            return None

        try:
            decoded = admin_auth.verify_id_token(token)
            return decoded
        except Exception:
            return None

    def _get_user_role(uid: str) -> str:
        try:
            user_doc = db.collection("users").document(uid).get()
            if user_doc.exists:
                data = user_doc.to_dict() or {}
                role = str(data.get("role") or "").strip().lower()
                return role
        except Exception:
            pass
        return ""

    @app.get("/api/health")
    def health() -> Any:
        return jsonify({"ok": True, "service": "parivesh-backend-python"})

    @app.get("/api/locations")
    def locations() -> Any:
        try:
            rows = []
            docs = db.collection("locationHierarchy").stream()
            for doc in docs:
                data = doc.to_dict() or {}
                state_name = str(
                    data.get("stateName")
                    or data.get("state")
                    or data.get("name")
                    or doc.id
                    or ""
                ).strip()

                districts = _normalize_districts(
                    data.get("districts") or data.get("districtList") or data.get("district")
                )

                if state_name and districts:
                    rows.append({"stateName": state_name, "districts": districts})

            rows.sort(key=lambda item: item["stateName"])
            return jsonify(rows)
        except Exception as exc:
            app.logger.exception("GET /api/locations failed: %s", exc)
            return jsonify({"message": "Failed to fetch locations."}), 500

    @app.get("/api/sectors")
    def sectors() -> Any:
        try:
            rows = []
            docs = db.collection("sectorParameters").stream()
            for doc in docs:
                data = doc.to_dict() or {}
                sector_name = str(data.get("sectorName") or "").strip()
                if not sector_name:
                    continue
                rows.append(
                    {
                        "id": doc.id,
                        "sectorName": sector_name,
                        "defaultNotes": str(data.get("defaultNotes") or "").strip(),
                    }
                )

            rows.sort(key=lambda item: item["sectorName"])
            return jsonify(rows)
        except Exception as exc:
            app.logger.exception("GET /api/sectors failed: %s", exc)
            return jsonify({"message": "Failed to fetch sectors."}), 500

    @app.post("/api/uploads")
    def uploads() -> Any:
        try:
            auth_user = _get_authenticated_user()
            if not auth_user:
                return jsonify({"message": "Unauthorized."}), 401

            owner_id = str(auth_user.get("uid") or "").strip()
            doc_key = str(request.form.get("docKey") or "").strip()
            uploaded_file = request.files.get("file")

            if not owner_id:
                return jsonify({"message": "ownerId is required."}), 400
            if not doc_key:
                return jsonify({"message": "docKey is required."}), 400
            if uploaded_file is None or not uploaded_file.filename:
                return jsonify({"message": "file is required."}), 400

            filename = secure_filename(uploaded_file.filename)
            content_type = (uploaded_file.mimetype or "").lower()

            if not filename.lower().endswith(".pdf") or "pdf" not in content_type:
                return jsonify({"message": "Only PDF files are allowed."}), 400

            user_dir = uploads_root / owner_id
            user_dir.mkdir(parents=True, exist_ok=True)

            stored_name = f"{uuid4().hex}_{doc_key}_{filename}"
            stored_path = user_dir / stored_name
            uploaded_file.save(stored_path)

            relative_path = f"{owner_id}/{stored_name}"
            file_url = f"{request.host_url.rstrip('/')}/uploads/{relative_path}"

            return jsonify(
                {
                    "key": doc_key,
                    "name": filename,
                    "url": file_url,
                    "contentType": uploaded_file.mimetype or "application/pdf",
                    "size": stored_path.stat().st_size,
                    "storedPath": str(stored_path),
                }
            )
        except Exception as exc:
            app.logger.exception("POST /api/uploads failed: %s", exc)
            return jsonify({"message": "Failed to upload file."}), 500

    @app.get("/uploads/<path:file_path>")
    def serve_upload(file_path: str) -> Any:
        return send_from_directory(uploads_root, file_path, as_attachment=False)

    @app.post("/api/process-documents")
    def process_documents() -> Any:
        auth_user = _get_authenticated_user()
        if not auth_user:
            return jsonify({"message": "Unauthorized."}), 401

        requester_uid = str(auth_user.get("uid") or "").strip()
        requester_role = _get_user_role(requester_uid)

        payload = request.get_json(silent=True) or {}
        docs = payload.get("documents")
        application_id = str(payload.get("applicationId") or "").strip()
        owner_id = requester_uid

        if not isinstance(docs, list) or not docs:
            return jsonify({"message": "documents array is required."}), 400

        if application_id:
            app_doc = db.collection("applications").document(application_id).get()
            if not app_doc.exists:
                return jsonify({"message": "Application not found."}), 404

            app_data = app_doc.to_dict() or {}
            app_owner_id = str(app_data.get("ownerId") or "").strip()
            owner_id = app_owner_id or requester_uid

            privileged_roles = {"admin", "scrutiny", "mom"}
            if requester_role not in privileged_roles and app_owner_id != requester_uid:
                return jsonify({"message": "Forbidden."}), 403

        processed: list[dict[str, Any]] = []
        for entry in docs:
            if not isinstance(entry, dict):
                continue

            key = str(entry.get("key") or "").strip()
            source = str(entry.get("url") or entry.get("path") or "").strip()
            local_path = _to_local_upload_path(source)

            if not local_path:
                processed.append(
                    {
                        "key": key,
                        "source": source,
                        "ok": False,
                        "error": "Invalid upload path.",
                    }
                )
                continue

            if not local_path.exists() or not local_path.is_file():
                processed.append(
                    {
                        "key": key,
                        "source": source,
                        "ok": False,
                        "error": "File not found.",
                    }
                )
                continue

            try:
                analysis = _analyze_pdf(local_path)
                processed.append(
                    {
                        "key": key,
                        "source": source,
                        "ok": True,
                        "analysis": analysis,
                    }
                )
            except Exception as exc:
                app.logger.exception("Failed processing document %s: %s", source, exc)
                processed.append(
                    {
                        "key": key,
                        "source": source,
                        "ok": False,
                        "error": "Processing failed.",
                    }
                )

        run_meta = {
            "applicationId": application_id,
            "ownerId": owner_id,
            "documents": processed,
            "count": len(processed),
            "okCount": len([item for item in processed if item.get("ok")]),
            "processedAt": datetime.now(timezone.utc).isoformat(),
        }

        if application_id:
            try:
                db.collection("documentProcessingHistory").add(run_meta)
            except Exception as exc:
                app.logger.exception("Failed to persist processing history: %s", exc)

        return jsonify(run_meta)

    @app.get("/api/process-documents-history")
    def process_documents_history() -> Any:
        auth_user = _get_authenticated_user()
        if not auth_user:
            return jsonify({"message": "Unauthorized."}), 401

        requester_uid = str(auth_user.get("uid") or "").strip()
        requester_role = _get_user_role(requester_uid)

        application_id = str(request.args.get("applicationId") or "").strip()

        if not application_id:
            return jsonify({"message": "applicationId query param is required."}), 400

        try:
            app_doc = db.collection("applications").document(application_id).get()
            if not app_doc.exists:
                return jsonify([])

            app_data = app_doc.to_dict() or {}
            app_owner_id = str(app_data.get("ownerId") or "").strip()
            privileged_roles = {"admin", "scrutiny", "mom"}
            if requester_role not in privileged_roles and app_owner_id != requester_uid:
                return jsonify({"message": "Forbidden."}), 403

            docs = (
                db.collection("documentProcessingHistory")
                .where("applicationId", "==", application_id)
                .stream()
            )

            rows: list[dict[str, Any]] = []
            for item in docs:
                data = item.to_dict() or {}
                rows.append(
                    {
                        "id": item.id,
                        "applicationId": data.get("applicationId"),
                        "ownerId": data.get("ownerId"),
                        "count": data.get("count", 0),
                        "okCount": data.get("okCount", 0),
                        "processedAt": data.get("processedAt"),
                        "documents": data.get("documents", []),
                    }
                )

            rows.sort(key=lambda entry: str(entry.get("processedAt") or ""), reverse=True)
            return jsonify(rows)
        except Exception as exc:
            app.logger.exception("GET /api/process-documents-history failed: %s", exc)
            return jsonify({"message": "Failed to fetch processing history."}), 500

    return app


if __name__ == "__main__":
    flask_app = create_app()
    port = int(os.getenv("PORT", "5000"))
    flask_app.run(host="0.0.0.0", port=port, debug=True)

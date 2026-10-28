from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .models import SourceType


class SourceCreate(BaseModel):
    identifier: str = Field(min_length=1, max_length=255)
    display_name: Optional[str] = Field(default=None, max_length=255)
    type: SourceType

    @field_validator("identifier")
    @classmethod
    def validate_identifier(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Identifier bo‘sh bo‘lishi mumkin emas.")
        return value

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        value = value.strip()
        return value or None


class SourceUpdate(BaseModel):
    is_active: Optional[bool] = None
    display_name: Optional[str] = Field(default=None, max_length=255)
    type: Optional[SourceType] = None


class SourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    identifier: str
    display_name: str
    type: SourceType
    is_active: bool
    created_at: datetime
    # Deep Upgrade v7: Telegram-style Profile Bar & Sidebar boyitilgan statistika
    unread_count: int = 0
    total_count: int = 0
    archived_count: int = 0
    media_count: int = 0
    starred_count: int = 0
    last_message_at: Optional[datetime] = None
    last_message_preview: Optional[str] = None
    last_sender_name: Optional[str] = None


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_id: int
    source_display_name: str
    source_identifier: Optional[str] = None
    source_type: Optional[str] = None
    source_is_active: bool = True
    sender_name: str
    text: str
    media_type: Optional[str]
    media_path: Optional[str]
    telegram_message_id: int
    received_at: datetime
    is_read: bool
    is_archived: bool = False
    archived_at: Optional[datetime] = None
    is_starred: bool = False
    reply_to_message_id: Optional[int] = None
    chat_id: Optional[int] = None
    direction: str = "in"
    has_media_file: bool = False
    media_mime: Optional[str] = None
    media_name: Optional[str] = None
    link_urls: Optional[list[str]] = None
    channel: str = "telegram"
    opp_score: Optional[int] = None
    triage_level: Optional[int] = None
    triage_reason: Optional[str] = None
    triage_auto_reply: Optional[str] = None
    triage_dashboard: Optional[dict] = None
    media_analysis: Optional[dict] = None

    @field_validator("link_urls", mode="before")
    @classmethod
    def _parse_link_urls(cls, value):
        if value is None or isinstance(value, list):
            return value
        import json

        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return None

    @field_validator("triage_dashboard", "media_analysis", mode="before")
    @classmethod
    def _parse_json_dict(cls, value):
        if value is None or isinstance(value, dict):
            return value
        import json

        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else None
        except (TypeError, ValueError):
            return None


class MessageCountsOut(BaseModel):
    telegram_unread: int
    email_unread: int
    archived: int
    opportunity_unread: int
    starred: int = 0
    telegram_total: int = 0
    email_total: int = 0


class DeleteBulkIn(BaseModel):
    ids: list[int]

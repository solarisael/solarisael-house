//! Domain types and invariants for the House remember vertical slice.

use std::fmt;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HouseMode {
    Base,
    Full,
    Degraded,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum HealthVerdict {
    Healthy,
    Unhealthy { reason: String },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Authority {
    Base,
    Full,
}

#[derive(Clone, Debug, PartialEq)]
pub enum DomainError {
    InvalidRoomKey(String),
    ReservedRoomKey,
    EmptyTitle,
    EmptyBody,
    UnsupportedKind(String),
    EmptySourcePath,
    InvalidSupersedes,
    InvalidField { field: String, kind: String },
    MissingProject,
    TooManyValues { field: String },
    FullUnhealthy { reason: String },
    DegradedUnavailable,
    EmptyQuery,
    InvalidTopK { field: String, value: u32 },
    InvalidThreshold { field: String, value: f64 },
}

impl fmt::Display for DomainError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRoomKey(value) => write!(f, "invalid room key: {value}"),
            Self::ReservedRoomKey => f.write_str("room key 'house' is reserved for shared use"),
            Self::EmptyTitle => f.write_str("lesson or memory title must not be empty"),
            Self::EmptyBody => f.write_str("lesson or memory body must not be empty"),
            Self::UnsupportedKind(kind) => write!(f, "unsupported remember kind: {kind}"),
            Self::EmptySourcePath => f.write_str("source path must not be empty"),
            Self::InvalidSupersedes => f.write_str("supersedes IDs must be positive"),
            Self::InvalidField { field, kind } => write!(f, "{field} is not valid for {kind}"),
            Self::MissingProject => f.write_str("project lesson requires a non-empty project"),
            Self::TooManyValues { field } => write!(f, "{field} contains too many values"),
            Self::FullUnhealthy { reason } => write!(f, "full authority is unhealthy: {reason}"),
            Self::DegradedUnavailable => f.write_str("degraded mode cannot durably remember"),
            Self::EmptyQuery => f.write_str("recall query must not be empty"),
            Self::InvalidTopK { field, value } => write!(f, "{field} must be positive and at most 1000: {value}"),
            Self::InvalidThreshold { field, value } => write!(f, "{field} must be finite and in [0, 1]: {value}"),
        }
    }
}


impl std::error::Error for DomainError {}

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub struct RoomKey(String);

impl RoomKey {
    pub fn new(value: impl Into<String>) -> Result<Self, DomainError> {
        let value = value.into();
        if value == "house" {
            return Err(DomainError::ReservedRoomKey);
        }
        let valid = !value.is_empty()
            && !value.starts_with('-')
            && !value.ends_with('-')
            && value.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            && !value.contains("--");
        if !valid {
            return Err(DomainError::InvalidRoomKey(value));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str { &self.0 }
}

const MAX_RECALL_TOP_K: u32 = 1_000;

#[derive(Clone, Debug, PartialEq)]
pub struct RecallRequest {
    room: RoomKey,
    query: String,
    semantic_top_k: u32,
    semantic_min_similarity: f64,
    content_top_k: u32,
    content_min_similarity: f64,
}

impl RecallRequest {
    pub fn new(
        room: RoomKey,
        query: String,
        semantic_top_k: u32,
        semantic_min_similarity: f64,
        content_top_k: u32,
        content_min_similarity: f64,
    ) -> Result<Self, DomainError> {
        if query.trim().is_empty() { return Err(DomainError::EmptyQuery); }
        for (field, value) in [
            ("semantic_top_k", semantic_top_k),
            ("content_top_k", content_top_k),
        ] {
            if value == 0 || value > MAX_RECALL_TOP_K {
                return Err(DomainError::InvalidTopK { field: field.into(), value });
            }
        }
        for (field, value) in [
            ("semantic_min_similarity", semantic_min_similarity),
            ("content_min_similarity", content_min_similarity),
        ] {
            if !value.is_finite() || !(0.0..=1.0).contains(&value) {
                return Err(DomainError::InvalidThreshold { field: field.into(), value });
            }
        }
        Ok(Self { room, query, semantic_top_k, semantic_min_similarity, content_top_k, content_min_similarity })
    }

    pub fn room(&self) -> &RoomKey { &self.room }
    pub fn query(&self) -> &str { &self.query }
    pub const fn semantic_top_k(&self) -> u32 { self.semantic_top_k }
    pub const fn semantic_min_similarity(&self) -> f64 { self.semantic_min_similarity }
    pub const fn content_top_k(&self) -> u32 { self.content_top_k }
    pub const fn content_min_similarity(&self) -> f64 { self.content_min_similarity }
}

impl fmt::Display for RoomKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { f.write_str(&self.0) }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RememberKind { Memory, CodingLesson, ProjectLesson, WritingLesson, AudioLesson }

impl RememberKind {
    pub fn parse(value: &str) -> Result<Self, DomainError> {
        match value {
            "memory" => Ok(Self::Memory),
            "coding-lesson" => Ok(Self::CodingLesson),
            "project-lesson" => Ok(Self::ProjectLesson),
            "writing-lesson" => Ok(Self::WritingLesson),
            "audio-lesson" => Ok(Self::AudioLesson),
            other => Err(DomainError::UnsupportedKind(other.to_owned())),
        }
    }
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Memory => "memory",
            Self::CodingLesson => "coding-lesson",
            Self::ProjectLesson => "project-lesson",
            Self::WritingLesson => "writing-lesson",
            Self::AudioLesson => "audio-lesson",
        }
    }
    pub const fn is_lesson(self) -> bool { !matches!(self, Self::Memory) }
}

const MAX_ARRAY_VALUES: usize = 64;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RememberRequest {
    room: RoomKey,
    kind: RememberKind,
    title: String,
    body: String,
    source_path: Option<String>,
    threads: Vec<String>,
    supersedes: Vec<u64>,
    backup: bool,
    shape: Option<String>,
    voice: Option<String>,
    scope: Option<String>,
    project: Option<String>,
    proof_pattern: Option<String>,
    trigger_context: Option<String>,
    tags: Vec<String>,
}

impl RememberRequest {
    pub fn new(
        room: RoomKey, kind: RememberKind, title: String, body: String,
        source_path: Option<String>, threads: Vec<String>, supersedes: Vec<u64>, backup: bool,
    ) -> Result<Self, DomainError> {
        if kind.is_lesson() {
            return Err(DomainError::InvalidField { field: "lesson fields".into(), kind: kind.as_str().into() });
        }
        Self::build(room, kind, title, body, source_path, threads, supersedes, backup,
            None, None, None, None, None, None, Vec::new())
    }

    pub fn new_lesson(
        room: RoomKey, kind: RememberKind, title: String, body: String, backup: bool,
        shape: Option<String>, voice: Option<String>, scope: Option<String>, project: Option<String>,
        proof_pattern: Option<String>, trigger_context: Option<String>, tags: Vec<String>,
    ) -> Result<Self, DomainError> {
        Self::build(room, kind, title, body, None, Vec::new(), Vec::new(), backup,
            shape, voice, scope, project, proof_pattern, trigger_context, tags)
    }

    #[allow(clippy::too_many_arguments)]
    fn build(
        room: RoomKey, kind: RememberKind, title: String, body: String,
        source_path: Option<String>, threads: Vec<String>, supersedes: Vec<u64>, backup: bool,
        shape: Option<String>, voice: Option<String>, scope: Option<String>, project: Option<String>,
        proof_pattern: Option<String>, trigger_context: Option<String>, tags: Vec<String>,
    ) -> Result<Self, DomainError> {
        if title.trim().is_empty() { return Err(DomainError::EmptyTitle); }
        if body.trim().is_empty() { return Err(DomainError::EmptyBody); }
        if threads.len() > MAX_ARRAY_VALUES || supersedes.len() > MAX_ARRAY_VALUES || tags.len() > MAX_ARRAY_VALUES {
            return Err(DomainError::TooManyValues { field: "array".into() });
        }
        if supersedes.iter().any(|&id| id == 0) { return Err(DomainError::InvalidSupersedes); }
        if kind.is_lesson() {
            if source_path.is_some() || !threads.is_empty() || !supersedes.is_empty() {
                return Err(DomainError::InvalidField { field: "source_path/threads/supersedes".into(), kind: kind.as_str().into() });
            }
            if matches!(kind, RememberKind::ProjectLesson) && project.as_deref().map_or(true, |p| p.trim().is_empty()) {
                return Err(DomainError::MissingProject);
            }
            if matches!(kind, RememberKind::WritingLesson | RememberKind::AudioLesson) && (scope.is_some() || project.is_some() || proof_pattern.is_some()) {
                return Err(DomainError::InvalidField { field: "scope/project/proof_pattern".into(), kind: kind.as_str().into() });
            }
            if matches!(kind, RememberKind::ProjectLesson) && (voice.is_some() || scope.is_some()) {
                return Err(DomainError::InvalidField { field: "voice/scope".into(), kind: kind.as_str().into() });
            }
        } else if shape.is_some() || voice.is_some() || scope.is_some() || project.is_some() || proof_pattern.is_some() || trigger_context.is_some() || !tags.is_empty() {
            return Err(DomainError::InvalidField { field: "lesson fields".into(), kind: kind.as_str().into() });
        }
        let source_path = source_path.and_then(|path| (!path.trim().is_empty()).then_some(path));
        let mut unique_supersedes = Vec::with_capacity(supersedes.len());
        for id in supersedes { if !unique_supersedes.contains(&id) { unique_supersedes.push(id); } }
        Ok(Self { room, kind, title, body, source_path, threads, supersedes: unique_supersedes, backup,
            shape, voice, scope, project, proof_pattern, trigger_context, tags })
    }

    pub fn room(&self) -> &RoomKey { &self.room }
    pub fn kind(&self) -> RememberKind { self.kind }
    pub fn title(&self) -> &str { &self.title }
    pub fn body(&self) -> &str { &self.body }
    pub fn source_path(&self) -> Option<&str> { self.source_path.as_deref() }
    pub fn threads(&self) -> &[String] { &self.threads }
    pub fn supersedes(&self) -> &[u64] { &self.supersedes }
    pub const fn backup(&self) -> bool { self.backup }
    pub fn shape(&self) -> Option<&str> { self.shape.as_deref() }
    pub fn voice(&self) -> Option<&str> { self.voice.as_deref() }
    pub fn scope(&self) -> Option<&str> { self.scope.as_deref() }
    pub fn project(&self) -> Option<&str> { self.project.as_deref() }
    pub fn proof_pattern(&self) -> Option<&str> { self.proof_pattern.as_deref() }
    pub fn trigger_context(&self) -> Option<&str> { self.trigger_context.as_deref() }
    pub fn tags(&self) -> &[String] { &self.tags }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RememberReceipt {
    memory_id: Option<u64>,
    lesson_id: Option<u64>,
    kind: RememberKind,
    room: RoomKey,
    source_path: Option<String>,
    warnings: Vec<String>,
}

impl RememberReceipt {
    pub fn committed(memory_id: u64, room: RoomKey, source_path: String, warnings: Vec<String>) -> Result<Self, DomainError> {
        if source_path.trim().is_empty() { return Err(DomainError::EmptySourcePath); }
        Ok(Self { memory_id: Some(memory_id), lesson_id: None, kind: RememberKind::Memory, room, source_path: Some(source_path), warnings })
    }
    pub fn committed_lesson(lesson_id: u64, kind: RememberKind, room: RoomKey, warnings: Vec<String>) -> Result<Self, DomainError> {
        if !kind.is_lesson() { return Err(DomainError::UnsupportedKind(kind.as_str().into())); }
        Ok(Self { memory_id: None, lesson_id: Some(lesson_id), kind, room, source_path: None, warnings })
    }
    pub fn memory_id(&self) -> u64 { self.memory_id.unwrap_or(0) }
    pub fn lesson_id(&self) -> u64 { self.lesson_id.unwrap_or(0) }
    pub const fn kind(&self) -> RememberKind { self.kind }
    pub fn room(&self) -> &RoomKey { &self.room }
    pub fn source_path(&self) -> &str { self.source_path.as_deref().unwrap_or("") }
    pub const fn durable(&self) -> bool { true }
    pub const fn authority(&self) -> Authority { Authority::Full }
    pub fn warnings(&self) -> &[String] { &self.warnings }
}

pub fn authorize(mode: HouseMode, health: HealthVerdict) -> Result<Authority, DomainError> {
    match (mode, health) {
        (HouseMode::Full, HealthVerdict::Healthy) => Ok(Authority::Full),
        (HouseMode::Full, HealthVerdict::Unhealthy { reason }) => Err(DomainError::FullUnhealthy { reason }),
        (HouseMode::Degraded, _) => Err(DomainError::DegradedUnavailable),
        (HouseMode::Base, _) => Ok(Authority::Base),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_room_keys_and_reserved_house() {
        assert!(RoomKey::new("living-room2").is_ok());
        for invalid in ["", "Living", "-room", "room-", "two--rooms", "house"] {
            assert!(RoomKey::new(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn accepts_canonical_room_keys_longer_than_63_bytes() {
        let room = "a".repeat(64);
        assert!(RoomKey::new(room).is_ok());
    }

    #[test]
    fn committed_receipt_requires_source_path_and_is_postgres_durable() {
        let room = RoomKey::new("lab").unwrap();
        assert!(RememberReceipt::committed(1, room.clone(), " ".into(), vec![]).is_err());
        let receipt = RememberReceipt::committed(1, room, "memory.md".into(), vec![]).unwrap();
        assert_eq!(receipt.source_path(), "memory.md");
        assert!(receipt.durable());
        assert_eq!(receipt.authority(), Authority::Full);
    }

    #[test]
    fn validates_memory_request_invariants() {
        let room = RoomKey::new("lab").unwrap();
        assert_eq!(RememberRequest::new(room.clone(), RememberKind::Memory, " ".into(), "body".into(), None, vec![], vec![], true), Err(DomainError::EmptyTitle));
        assert_eq!(RememberRequest::new(room, RememberKind::Memory, "title".into(), "\n".into(), None, vec![], vec![], true), Err(DomainError::EmptyBody));
    }

    #[test]
    fn full_unhealthy_never_falls_back_to_base() {
        let result = authorize(HouseMode::Full, HealthVerdict::Unhealthy { reason: "db down".into() });
        assert_eq!(result, Err(DomainError::FullUnhealthy { reason: "db down".into() }));
        assert_eq!(authorize(HouseMode::Degraded, HealthVerdict::Healthy), Err(DomainError::DegradedUnavailable));
    }
}

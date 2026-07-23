//! Newline-delimited JSON wire protocol, version 1.

use house_core::{AnamnesisActivation, AnamnesisAddRequest, AnamnesisAppendReceipt, AnamnesisAppendRequest, AnamnesisFidelity, AnamnesisKind, AnamnesisReadMode, AnamnesisReadRequest, AnamnesisReceipt, AnamnesisSeedRep, ClusterMaintenanceOperation, ClusterMaintenanceRequest, ClusterMaintenanceResult, ClusterStaleness, RecallRequest, RememberKind, RememberReceipt, RememberRequest, RoomKey};
use serde::{de::{DeserializeOwned, Error as DeError}, Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};
use std::fmt;

pub const PROTOCOL_VERSION: u8 = 1;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct RequestEnvelope {
    pub protocol: u8,
    pub id: String,
    pub method: String,
    pub params: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct RememberParams {
    pub room: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(default)]
    pub threads: Vec<String>,
    #[serde(default)]
    pub supersedes: Vec<String>,
    #[serde(default)]
    pub shape: Option<String>,
    #[serde(default)]
    pub voice: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default, rename = "proofPattern")]
    pub proof_pattern: Option<String>,
    #[serde(default, rename = "triggerContext")]
    pub trigger_context: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_backup")]
    pub backup: bool,
}

fn default_backup() -> bool { true }

fn default_semantic_top_k() -> u32 { 8 }
fn default_semantic_min_similarity() -> f64 { 0.50 }
fn default_content_top_k() -> u32 { 8 }
fn default_content_min_similarity() -> f64 { 0.30 }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct RecallParams {
    pub room: String,
    pub query: String,
    #[serde(default = "default_semantic_top_k")]
    pub semantic_top_k: u32,
    #[serde(default = "default_semantic_min_similarity")]
    pub semantic_min_similarity: f64,
    #[serde(default = "default_content_top_k")]
    pub content_top_k: u32,
    #[serde(default = "default_content_min_similarity")]
    pub content_min_similarity: f64,
}

fn deserialize_unit_fraction<'de, D>(deserializer: D) -> Result<f64, D::Error>
where D: Deserializer<'de> {
    let value = f64::deserialize(deserializer)?;
    if value.is_finite() && (0.0..=1.0).contains(&value) { Ok(value) } else { Err(D::Error::custom("must be finite and between 0 and 1")) }
}
fn default_cluster_k() -> u32 { 8 }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ClusterMaintenanceParams {
    pub room: String,
    pub operation: String,
    #[serde(default)] pub dry_run: bool,
    #[serde(default)] pub if_stale: bool,
    #[serde(default = "default_cluster_k")] pub k: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ClusterStalenessTelemetry {
    pub built_at: Option<String>,
    pub chunks_since_build: u64,
    #[serde(deserialize_with = "deserialize_unit_fraction")]
    pub fraction_unseen: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ClusterResonanceTelemetry {
    pub profile: Vec<ClusterProfileEntry>,
    pub hot: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ClusterProfileEntry {
    pub label: String,
    #[serde(deserialize_with = "deserialize_unit_fraction")]
    pub activation: f64,
    pub member_count: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct RecallResult {
    pub ok: bool,
    pub query: String,
    pub found: bool,
    pub source: String,
    #[serde(rename = "retrievalCandidates")]
    pub retrieval_candidates: Vec<Value>,
    #[serde(rename = "canonMatches")]
    pub canon_matches: Vec<Value>,
    #[serde(rename = "semanticChunks")]
    pub semantic_chunks: Vec<Value>,
    #[serde(rename = "contentChunks")]
    pub content_chunks: Vec<Value>,
    #[serde(rename = "dateMatches")]
    pub date_matches: Vec<Value>,
    #[serde(rename = "queryDates")]
    pub query_dates: Vec<Value>,
    pub taxonomy: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clusters: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "clusterStaleness")]
    pub cluster_staleness: Option<ClusterStalenessTelemetry>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "clusterResonance")]
    pub cluster_resonance: Option<ClusterResonanceTelemetry>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "memoryHandle")]
    pub memory_handle: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClusterMaintenanceStalenessResult {
    pub built_at: Option<String>,
    pub clusters: u64,
    pub chunks_total: u64,
    pub chunks_since_build: u64,
    pub fraction_unseen: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClusterSummaryResult {
    pub cluster_id: i64,
    pub label: String,
    pub member_count: u64,
    pub accepted: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClusterMaintenanceStatusResult {
    pub stale: bool,
    pub reason: String,
    pub staleness: ClusterMaintenanceStalenessResult,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClusterMaintenanceResultWire {
    pub ok: bool,
    pub operation: String,
    pub dry_run: bool,
    pub rebuilt: bool,
    pub status: ClusterMaintenanceStatusResult,
    pub clusters: Vec<ClusterSummaryResult>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(bound(deserialize = "T: DeserializeOwned"))]
pub struct ResponseEnvelope<T> {
    pub protocol: u8,
    pub id: String,
    #[serde(flatten)]
    pub payload: ResponsePayload<T>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(untagged)]
pub enum ResponsePayload<T> {
    Result { result: T },
    Error { error: ProtocolErrorBody },
}

impl<'de, T: DeserializeOwned> Deserialize<'de> for ResponsePayload<T> {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where D: Deserializer<'de> {
        let mut object = Map::<String, Value>::deserialize(deserializer)?;
        let result = object.remove("result");
        let error = object.remove("error");
        if !object.is_empty() || result.is_some() == error.is_some() {
            return Err(D::Error::custom("response must contain exactly one result or error branch"));
        }
        match (result, error) {
            (Some(value), None) => serde_json::from_value(value).map(|result| Self::Result { result }).map_err(D::Error::custom),
            (None, Some(value)) => serde_json::from_value(value).map(|error| Self::Error { error }).map_err(D::Error::custom),
            _ => unreachable!(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ProtocolErrorBody {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct RememberResult {
    #[serde(skip_serializing_if = "is_zero")]
    pub memory_id: u64,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub room: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub source_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lesson_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub durable: bool,
    pub authority: String,
    pub warnings: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RememberResultWire {
    #[serde(default)]
    memory_id: Option<u64>,
    #[serde(default)]
    room: Option<String>,
    #[serde(default)]
    source_path: Option<String>,
    #[serde(default)]
    lesson_id: Option<u64>,
    #[serde(default)]
    kind: Option<String>,
    durable: Option<bool>,
    authority: Option<String>,
    warnings: Option<Vec<String>>,
}

impl<'de> Deserialize<'de> for RememberResult {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = RememberResultWire::deserialize(deserializer)?;
        let has_memory = wire.memory_id.is_some() || wire.room.is_some() || wire.source_path.is_some();
        let has_lesson = wire.lesson_id.is_some() || wire.kind.is_some();
        let durable = wire.durable.ok_or_else(|| D::Error::missing_field("durable"))?;
        let authority = wire.authority.ok_or_else(|| D::Error::missing_field("authority"))?;
        let warnings = wire.warnings.ok_or_else(|| D::Error::missing_field("warnings"))?;
        match (has_memory, has_lesson) {
            (true, true) => Err(D::Error::custom("memory and lesson receipt fields cannot be mixed")),
            (true, false) => Ok(Self {
                memory_id: wire.memory_id.ok_or_else(|| D::Error::missing_field("memory_id"))?,
                room: wire.room.ok_or_else(|| D::Error::missing_field("room"))?,
                source_path: wire.source_path.ok_or_else(|| D::Error::missing_field("source_path"))?,
                lesson_id: None,
                kind: None,
                durable,

                authority,
                warnings,
            }),
            (false, true) => Ok(Self {
                memory_id: 0,
                room: String::new(),
                source_path: String::new(),
                lesson_id: Some(wire.lesson_id.ok_or_else(|| D::Error::missing_field("lesson_id"))?),
                kind: Some(wire.kind.ok_or_else(|| D::Error::missing_field("kind"))?),
                durable,
                authority,
                warnings,
            }),
            (false, false) => Err(D::Error::custom("receipt must contain memory or lesson fields")),
        }
    }
}

fn is_zero(value: &u64) -> bool { *value == 0 }

impl TryFrom<RecallParams> for RecallRequest {
    type Error = ProtocolError;

    fn try_from(params: RecallParams) -> Result<Self, Self::Error> {
        let room = RoomKey::new(params.room)
            .map_err(|e| ProtocolError::InvalidParams(e.to_string()))?;
        RecallRequest::new(
            room,
            params.query,
            params.semantic_top_k,
            params.semantic_min_similarity,
            params.content_top_k,
            params.content_min_similarity,
        ).map_err(|e| ProtocolError::InvalidParams(e.to_string()))
    }
}
impl TryFrom<ClusterMaintenanceParams> for ClusterMaintenanceRequest {
    type Error = ProtocolError;
    fn try_from(p: ClusterMaintenanceParams) -> Result<Self, Self::Error> {
        let room = RoomKey::new(p.room).map_err(|e| ProtocolError::InvalidParams(e.to_string()))?;
        let operation = ClusterMaintenanceOperation::parse(&p.operation).map_err(|e| ProtocolError::InvalidParams(e.to_string()))?;
        Self::new(room, operation, p.dry_run, p.if_stale, p.k).map_err(|e| ProtocolError::InvalidParams(e.to_string()))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProtocolError {
    Malformed(String),
    ProtocolMismatch(u8),
    UnknownMethod(String),
    InvalidParams(String),
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Malformed(message) => write!(f, "malformed request: {message}"),
            Self::ProtocolMismatch(version) => write!(f, "unsupported protocol version: {version}"),
            Self::UnknownMethod(method) => write!(f, "unknown method: {method}"),
            Self::InvalidParams(error) => write!(f, "invalid parameters: {error}"),
        }
    }
}
impl std::error::Error for ProtocolError {}

impl From<ProtocolError> for ProtocolErrorBody {
    fn from(error: ProtocolError) -> Self {
        let (code, retryable) = match &error {
            ProtocolError::Malformed(_) => ("malformed_request", false),
            ProtocolError::ProtocolMismatch(_) => ("protocol_mismatch", false),
            ProtocolError::UnknownMethod(_) => ("unknown_method", false),
            ProtocolError::InvalidParams(_) => ("invalid_params", false),
        };
        Self { code: code.into(), message: error.to_string(), retryable, details: None }
    }
}

impl TryFrom<RememberParams> for RememberRequest {
    type Error = ProtocolError;
    fn try_from(params: RememberParams) -> Result<Self, Self::Error> {
        let room = RoomKey::new(params.room).map_err(|e| ProtocolError::InvalidParams(e.to_string()))?;
        let kind = RememberKind::parse(&params.kind).map_err(|e| ProtocolError::InvalidParams(e.to_string()))?;
        if kind.is_lesson() && (params.source_path.is_some() || !params.threads.is_empty() || !params.supersedes.is_empty()) {
            return Err(ProtocolError::InvalidParams("memory-only fields are not valid for lessons".into()));
        }
        if !kind.is_lesson() && (params.shape.is_some() || params.voice.is_some() || params.scope.is_some() || params.project.is_some() || params.proof_pattern.is_some() || params.trigger_context.is_some() || !params.tags.is_empty()) {
            return Err(ProtocolError::InvalidParams("lesson-only fields are not valid for memory".into()));
        }
        let mut supersedes = Vec::with_capacity(params.supersedes.len());
        for raw in params.supersedes {
            let id = raw.parse::<i64>().ok().filter(|&id| id > 0).ok_or_else(|| {
                ProtocolError::InvalidParams(format!("supersedes ID must be a positive PostgreSQL BIGINT decimal: {raw}"))
            })? as u64;
            if !supersedes.contains(&id) { supersedes.push(id); }
        }
        let result = if kind.is_lesson() {
            RememberRequest::new_lesson(room, kind, params.title, params.body, params.backup,
                params.shape, params.voice, params.scope, params.project, params.proof_pattern,
                params.trigger_context, params.tags)
        } else {
            RememberRequest::new(room, kind, params.title, params.body, params.source_path,
                params.threads, supersedes, params.backup)
        };
        result.map_err(|e| ProtocolError::InvalidParams(e.to_string()))
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AnamnesisParams {
    pub room: String,
    pub mode: String,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default = "default_anamnesis_limit")]
    pub limit: u32,
}
fn default_anamnesis_limit() -> u32 { 10 }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AnamnesisWriteParams {
    pub operation: String,
    #[serde(default)] pub room: Option<String>,
    #[serde(default)] pub kind: Option<String>,
    #[serde(default)] pub fidelity: Option<String>,
    #[serde(default)] pub activation: Option<String>,
    #[serde(default)] pub title: Option<String>,
    #[serde(default)] pub shape: Option<String>,
    #[serde(default)] pub dormant: bool,
    #[serde(default)] pub ramp: Option<String>,
    #[serde(default)] pub counsel: Option<String>,
    #[serde(default)] pub peak: Option<String>,
    #[serde(default)] pub beginning: Option<String>,
    #[serde(default)] pub verify_note: Option<String>,
    #[serde(default)] pub canon: Vec<String>,
    #[serde(default)] pub source_paths: Vec<String>,
    #[serde(default)] pub tags: Vec<String>,
    #[serde(default)] pub allow_empty_cycle: bool,
    #[serde(default)] pub seed_rep: Option<AnamnesisSeedRepParams>,
    #[serde(default)] pub rep_number: Option<u32>,
    #[serde(default)] pub occurred_on: Option<String>,
    #[serde(default)] pub how_it_went: Option<String>,
    #[serde(default)] pub portal_pull: Option<String>,
    #[serde(default)] pub lighter: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AnamnesisSeedRepParams { pub number: u32, #[serde(default)] pub occurred_on: Option<String>, pub how_it_went: String, pub portal_pull: String, pub lighter: String }

impl TryFrom<AnamnesisParams> for AnamnesisReadRequest {
    type Error = ProtocolError;
    fn try_from(p: AnamnesisParams) -> Result<Self, Self::Error> {
        let room = RoomKey::for_anamnesis(p.room).map_err(|e| ProtocolError::InvalidParams(e.to_string()))?;
        let mode = AnamnesisReadMode::parse(&p.mode).map_err(|e| ProtocolError::InvalidParams(e.to_string()))?;
        Self::new(room, mode, p.query, p.limit).map_err(|e| ProtocolError::InvalidParams(e.to_string()))
    }
}
impl TryFrom<AnamnesisWriteParams> for AnamnesisAddRequest {
    type Error = ProtocolError;
    fn try_from(p: AnamnesisWriteParams) -> Result<Self, Self::Error> {
        if p.operation != "add" { return Err(ProtocolError::InvalidParams("operation is not add".into())); }
        let room = RoomKey::for_anamnesis(p.room.ok_or_else(|| ProtocolError::InvalidParams("add requires room".into()))?).map_err(|e| ProtocolError::InvalidParams(e.to_string()))?;
        let kind = AnamnesisKind::parse(&p.kind.ok_or_else(|| ProtocolError::InvalidParams("add requires kind".into()))?).map_err(|e| ProtocolError::InvalidParams(e.to_string()))?;
        let fidelity = AnamnesisFidelity::parse(&p.fidelity.ok_or_else(|| ProtocolError::InvalidParams("add requires fidelity".into()))?).map_err(|e| ProtocolError::InvalidParams(e.to_string()))?;
        let activation = AnamnesisActivation::parse(&p.activation.ok_or_else(|| ProtocolError::InvalidParams("add requires activation".into()))?).map_err(|e| ProtocolError::InvalidParams(e.to_string()))?;
        if kind == AnamnesisKind::Pillar && p.seed_rep.is_some() { return Err(ProtocolError::InvalidParams("pillars cannot include seedRep".into())); }
        let seed = p.seed_rep.map(|s| AnamnesisSeedRep::new(s.number, s.occurred_on, s.how_it_went, s.portal_pull, s.lighter)).transpose().map_err(|e| ProtocolError::InvalidParams(e.to_string()))?;
        AnamnesisAddRequest::new(room, kind, fidelity, activation, p.title.unwrap_or_default(), p.shape, p.dormant, p.ramp.unwrap_or_default(), p.counsel, p.peak, p.beginning, p.verify_note, p.canon, p.source_paths, p.tags, p.allow_empty_cycle, seed).map_err(|e| ProtocolError::InvalidParams(e.to_string()))
    }
}
impl AnamnesisWriteParams {
    pub fn append_request(self) -> Result<AnamnesisAppendRequest, ProtocolError> {
        if self.operation != "append-rep" { return Err(ProtocolError::InvalidParams("operation is not append-rep".into())); }
        let room = RoomKey::for_anamnesis(self.room.ok_or_else(|| ProtocolError::InvalidParams("append-rep requires room".into()))?).map_err(|e| ProtocolError::InvalidParams(e.to_string()))?;
        AnamnesisAppendRequest::new(room, self.title.unwrap_or_default(), self.rep_number.unwrap_or(0), self.occurred_on, self.how_it_went.unwrap_or_default(), self.portal_pull.unwrap_or_default(), self.lighter.unwrap_or_default(), self.source_paths).map_err(|e| ProtocolError::InvalidParams(e.to_string()))
    }
}

impl RequestEnvelope {
    pub fn remember_request(self) -> Result<RememberRequest, ProtocolError> {
        if self.protocol != PROTOCOL_VERSION { return Err(ProtocolError::ProtocolMismatch(self.protocol)); }
        if self.method != "remember" { return Err(ProtocolError::UnknownMethod(self.method)); }
        let params: RememberParams = serde_json::from_value(self.params).map_err(|e| ProtocolError::InvalidParams(e.to_string()))?;
        params.try_into()
    }
    pub fn recall_request(self) -> Result<RecallRequest, ProtocolError> {
        if self.protocol != PROTOCOL_VERSION { return Err(ProtocolError::ProtocolMismatch(self.protocol)); }
        if self.method != "recall" { return Err(ProtocolError::UnknownMethod(self.method)); }
        let params: RecallParams = serde_json::from_value(self.params).map_err(|e| ProtocolError::InvalidParams(e.to_string()))?;
        params.try_into()
    }
    pub fn cluster_maintenance_request(self) -> Result<ClusterMaintenanceRequest, ProtocolError> {
        if self.protocol != PROTOCOL_VERSION { return Err(ProtocolError::ProtocolMismatch(self.protocol)); }
        if self.method != "cluster_maintenance" { return Err(ProtocolError::UnknownMethod(self.method)); }
        serde_json::from_value::<ClusterMaintenanceParams>(self.params)
            .map_err(|e| ProtocolError::InvalidParams(e.to_string()))?
            .try_into()
    }
    pub fn anamnesis_request(self) -> Result<AnamnesisReadRequest, ProtocolError> {
        if self.protocol != PROTOCOL_VERSION { return Err(ProtocolError::ProtocolMismatch(self.protocol)); }
        if self.method != "anamnesis" { return Err(ProtocolError::UnknownMethod(self.method)); }
        serde_json::from_value::<AnamnesisParams>(self.params).map_err(|e| ProtocolError::InvalidParams(e.to_string()))?.try_into()
    }
    pub fn anamnesis_add_request(self) -> Result<AnamnesisAddRequest, ProtocolError> {
        if self.protocol != PROTOCOL_VERSION { return Err(ProtocolError::ProtocolMismatch(self.protocol)); }
        if self.method != "anamnesis_write" { return Err(ProtocolError::UnknownMethod(self.method)); }
        serde_json::from_value::<AnamnesisWriteParams>(self.params).map_err(|e| ProtocolError::InvalidParams(e.to_string()))?.try_into()
    }
    pub fn anamnesis_append_request(self) -> Result<AnamnesisAppendRequest, ProtocolError> {
        if self.protocol != PROTOCOL_VERSION { return Err(ProtocolError::ProtocolMismatch(self.protocol)); }
        if self.method != "anamnesis_write" { return Err(ProtocolError::UnknownMethod(self.method)); }
        serde_json::from_value::<AnamnesisWriteParams>(self.params).map_err(|e| ProtocolError::InvalidParams(e.to_string()))?.append_request()
    }
    pub fn parse_line(line: &str) -> Result<Self, ProtocolError> {
        serde_json::from_str(line).map_err(|e| ProtocolError::Malformed(e.to_string()))
    }
}

impl From<RememberReceipt> for RememberResult {
    fn from(receipt: RememberReceipt) -> Self {
        Self {
            memory_id: receipt.memory_id(),
            room: if receipt.kind().is_lesson() { String::new() } else { receipt.room().to_string() },
            source_path: if receipt.kind().is_lesson() { String::new() } else { receipt.source_path().to_owned() },
            lesson_id: (receipt.lesson_id() != 0).then_some(receipt.lesson_id()),
            kind: receipt.kind().is_lesson().then(|| receipt.kind().as_str().to_owned()),
            durable: receipt.durable(),
            authority: "postgres".into(),
            warnings: receipt.warnings().to_vec(),
        }
    }
}

pub fn success<T>(id: impl Into<String>, result: T) -> ResponseEnvelope<T> {
    ResponseEnvelope { protocol: PROTOCOL_VERSION, id: id.into(), payload: ResponsePayload::Result { result } }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnamnesisResult {
    pub ok: bool,
    pub mode: String,
    pub room: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    pub found: bool,
    #[serde(default)]
    pub entries: Vec<Value>,
    #[serde(default)]
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnamnesisWriteResult {
    pub ok: bool,
    pub operation: String,
    pub room: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rep_number: Option<u32>,
    pub durable: bool,
    pub authority: String,
    #[serde(default)]
    pub warnings: Vec<String>,
}
impl From<AnamnesisReceipt> for AnamnesisWriteResult {
    fn from(r: AnamnesisReceipt) -> Self { Self { ok: true, operation: "add".into(), room: r.room().to_string(), title: Some(r.title().into()), kind: Some(r.kind().as_str().into()), rep_number: None, durable: r.durable(), authority: "postgres".into(), warnings: r.warnings().to_vec() } }
}
impl From<AnamnesisAppendReceipt> for AnamnesisWriteResult {
    fn from(r: AnamnesisAppendReceipt) -> Self { Self { ok: true, operation: "append-rep".into(), room: r.room().to_string(), title: Some(r.title().into()), kind: None, rep_number: Some(r.rep_number()), durable: r.durable(), authority: "postgres".into(), warnings: r.warnings().to_vec() } }
}
pub type AnamnesisReadResult = AnamnesisResult;
pub type AnamnesisReceiptResult = AnamnesisWriteResult;


pub fn error<T>(id: impl Into<String>, error: ProtocolError) -> ResponseEnvelope<T> {
    ResponseEnvelope { protocol: PROTOCOL_VERSION, id: id.into(), payload: ResponsePayload::Error { error: error.into() } }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_v1_request_and_response_shape() {
        let line = r#"{"protocol":1,"id":"x","method":"remember","params":{"room":"lab","kind":"memory","title":"T","body":"B","backup":true}}"#;
        let request = RequestEnvelope::parse_line(line).unwrap();
        assert_eq!(request.remember_request().unwrap().room().as_str(), "lab");
        let json = serde_json::to_string(&success("x", RememberResult { memory_id: 4, room: "lab".into(), source_path: "mem.md".into(), lesson_id: None, kind: None, durable: true, authority: "postgres".into(), warnings: vec![] })).unwrap();
        assert_eq!(json, r#"{"protocol":1,"id":"x","result":{"memory_id":4,"room":"lab","source_path":"mem.md","durable":true,"authority":"postgres","warnings":[]}}"#);
    }

    #[test]
    fn anamnesis_accepts_house_and_preserves_query_in_exact_result_json() {
        let request = RequestEnvelope::parse_line(
            r#"{"protocol":1,"id":"a","method":"anamnesis","params":{"room":"house","mode":"consult","query":"needle"}}"#,
        ).unwrap();
        let parsed = request.anamnesis_request().unwrap();
        assert_eq!(parsed.room().as_str(), "house");
        assert_eq!(parsed.query(), Some("needle"));
        let json = serde_json::to_string(&success("a", AnamnesisResult {
            ok: true, mode: "consult".into(), room: "house".into(), query: Some("needle".into()),
            found: true, entries: vec![serde_json::json!({"title":"T"})], warnings: vec![],
        })).unwrap();
        assert_eq!(json, r#"{"protocol":1,"id":"a","result":{"ok":true,"mode":"consult","room":"house","query":"needle","found":true,"entries":[{"title":"T"}],"warnings":[]}}"#);
        let remember = RequestEnvelope { protocol: 1, id: "r".into(), method: "remember".into(), params: serde_json::json!({"room":"house","kind":"memory","title":"T","body":"B"}) };
        assert!(remember.remember_request().is_err());
    }


    #[test]
    fn remember_result_deserializes_memory_and_lesson_receipts_without_hybrids() {
        let memory: RememberResult = serde_json::from_value(serde_json::json!({
            "memory_id": 4, "room": "lab", "source_path": "mem.md",
            "durable": true, "authority": "postgres", "warnings": []
        })).unwrap();
        assert_eq!(memory.memory_id, 4);
        assert_eq!(memory.lesson_id, None);

        let lesson: RememberResult = serde_json::from_value(serde_json::json!({
            "lesson_id": 9, "kind": "coding-lesson",
            "durable": true, "authority": "postgres", "warnings": []
        })).unwrap();
        assert_eq!(lesson.lesson_id, Some(9));
        assert_eq!(lesson.kind.as_deref(), Some("coding-lesson"));
        assert_eq!(lesson.memory_id, 0);

        let hybrid = serde_json::json!({
            "memory_id": 4, "room": "lab", "source_path": "mem.md",
            "lesson_id": 9, "kind": "coding-lesson",
            "durable": true, "authority": "postgres", "warnings": []
        });
        assert!(serde_json::from_value::<RememberResult>(hybrid).is_err());
    }
    #[test]
    fn rejects_mismatch_malformed_unknown_and_bad_param_shape() {
        let mismatch = RequestEnvelope { protocol: 2, id: "x".into(), method: "remember".into(), params: Value::Null };
        assert!(matches!(mismatch.remember_request(), Err(ProtocolError::ProtocolMismatch(2))));
        assert!(matches!(RequestEnvelope::parse_line("{"), Err(ProtocolError::Malformed(_))));
        let unknown = RequestEnvelope { protocol: 1, id: "x".into(), method: "recall".into(), params: Value::Null };
        assert!(matches!(unknown.remember_request(), Err(ProtocolError::UnknownMethod(_))));
        let bad = RequestEnvelope { protocol: 1, id: "x".into(), method: "remember".into(), params: serde_json::json!({"room":"lab","kind":"memory","title":"T","body":"B","threads":"x"}) };
        assert!(matches!(bad.remember_request(), Err(ProtocolError::InvalidParams(_))));
    }

    #[test]
    fn rejects_unknown_envelope_and_params_fields() {
        let envelope = r#"{"protocol":1,"id":"x","method":"remember","params":{"room":"lab","kind":"memory","title":"T","body":"B"},"extra":true}"#;
        assert!(matches!(RequestEnvelope::parse_line(envelope), Err(ProtocolError::Malformed(_))));

        let params = RequestEnvelope {
            protocol: 1,
            id: "x".into(),
            method: "remember".into(),
            params: serde_json::json!({"room":"lab","kind":"memory","title":"T","body":"B","extra":true}),
        };
        assert!(matches!(params.remember_request(), Err(ProtocolError::InvalidParams(_))));
    }

    #[test]
    fn supersedes_strings_are_positive_postgres_bigints_and_deduplicated() {
        let params = RememberParams { room: "lab".into(), kind: "memory".into(), title: "T".into(), body: "B".into(), source_path: None, threads: vec![], supersedes: vec!["41".into(), "42".into(), "41".into()], shape: None, voice: None, scope: None, project: None, proof_pattern: None, trigger_context: None, tags: vec![], backup: true };
        assert_eq!(RememberRequest::try_from(params).unwrap().supersedes(), &[41, 42]);
        let max = i64::MAX.to_string();
        let params = RememberParams { supersedes: vec![max], room: "lab".into(), kind: "memory".into(), title: "T".into(), body: "B".into(), source_path: None, threads: vec![], shape: None, voice: None, scope: None, project: None, proof_pattern: None, trigger_context: None, tags: vec![], backup: true };
        assert_eq!(RememberRequest::try_from(params).unwrap().supersedes(), &[i64::MAX as u64]);
        for bad in ["0", "9223372036854775808", "nope"] {
            let params = RememberParams { supersedes: vec![bad.into()], room: "lab".into(), kind: "memory".into(), title: "T".into(), body: "B".into(), source_path: None, threads: vec![], shape: None, voice: None, scope: None, project: None, proof_pattern: None, trigger_context: None, tags: vec![], backup: true };
            assert!(matches!(RememberRequest::try_from(params), Err(ProtocolError::InvalidParams(_))));
        }
    }

    #[test]
    fn response_requires_exactly_one_branch() {
        let both = r#"{"protocol":1,"id":"x","result":{},"error":{}}"#;
        let neither = r#"{"protocol":1,"id":"x"}"#;
        assert!(serde_json::from_str::<ResponseEnvelope<Value>>(both).is_err());
        assert!(serde_json::from_str::<ResponseEnvelope<Value>>(neither).is_err());
    }
    #[test]
    fn recall_defaults_validate_and_round_trip() {
        let request = RequestEnvelope::parse_line(
            r#"{"protocol":1,"id":"r","method":"recall","params":{"room":"lab","query":"alpha"}}"#,
        ).unwrap();
        let recall = request.recall_request().unwrap();
        assert_eq!(recall.semantic_top_k(), 8);
        assert_eq!(recall.semantic_min_similarity(), 0.50);
        assert_eq!(recall.content_top_k(), 8);
        assert_eq!(recall.content_min_similarity(), 0.30);

        let params: RecallParams = serde_json::from_value(serde_json::json!({"room":"lab","query":"alpha"})).unwrap();
        assert_eq!(serde_json::to_string(&params).unwrap(),
            r#"{"room":"lab","query":"alpha","semantic_top_k":8,"semantic_min_similarity":0.5,"content_top_k":8,"content_min_similarity":0.3}"#);
    }

    #[test]
    fn recall_rejects_bounds_nonfinite_unknown_fields_and_methods() {
        let base = |params| RequestEnvelope { protocol: 1, id: "r".into(), method: "recall".into(), params };
        for key in ["semantic_top_k", "content_top_k"] {
            let mut value = serde_json::json!({"room":"lab","query":"x"});
            value[key] = serde_json::json!(0);
            assert!(matches!(base(value).recall_request(), Err(ProtocolError::InvalidParams(_))));
        }
        let mut value = serde_json::json!({"room":"lab","query":"x"});
        value["semantic_min_similarity"] = serde_json::json!(1.1);
        assert!(base(value).recall_request().is_err());
        let params = RecallParams { room: "lab".into(), query: "x".into(), semantic_top_k: 8, semantic_min_similarity: f64::NAN, content_top_k: 8, content_min_similarity: 0.3 };
        assert!(RecallRequest::try_from(params).is_err());
        let unknown = serde_json::json!({"room":"lab","query":"x","extra":true});
        assert!(base(unknown).recall_request().is_err());
        let wrong = RequestEnvelope { protocol: 1, id: "r".into(), method: "other".into(), params: serde_json::json!({}) };
        assert!(matches!(wrong.recall_request(), Err(ProtocolError::UnknownMethod(_))));
    }
    #[test]
    fn all_lesson_kinds_validate_defaults_and_receipt_shape() {
        for kind in ["coding-lesson", "project-lesson", "writing-lesson", "audio-lesson"] {
            let mut params = serde_json::json!({"room":"lab","kind":kind,"title":"T","body":"B"});
            if kind == "project-lesson" { params["project"] = serde_json::json!("app"); }
            let request = RequestEnvelope { protocol: 1, id: "l".into(), method: "remember".into(), params };
            let parsed = request.remember_request().unwrap();
            assert_eq!(parsed.kind().as_str(), kind);
            let receipt = RememberReceipt::committed_lesson(9, parsed.kind(), RoomKey::new("lab").unwrap(), vec![]).unwrap();
            let json = serde_json::to_string(&success("l", RememberResult::from(receipt))).unwrap();
            assert_eq!(json, format!(r#"{{"protocol":1,"id":"l","result":{{"lesson_id":9,"kind":"{kind}","durable":true,"authority":"postgres","warnings":[]}}}}"#));
        }
    }

    #[test]
    fn lessons_reject_memory_fields_and_require_project() {
        let base = |params| RequestEnvelope { protocol: 1, id: "l".into(), method: "remember".into(), params };
        assert!(base(serde_json::json!({"room":"lab","kind":"project-lesson","title":"T","body":"B"})).remember_request().is_err());
        assert!(base(serde_json::json!({"room":"lab","kind":"coding-lesson","title":"T","body":"B","threads":["x"]})).remember_request().is_err());
        assert!(base(serde_json::json!({"room":"lab","kind":"writing-lesson","title":"T","body":"B","project":"x"})).remember_request().is_err());
        assert!(base(serde_json::json!({"room":"lab","kind":"memory","title":"T","body":"B","shape":"x"})).remember_request().is_err());
    }
    #[test]
    fn cluster_maintenance_is_strict_and_camel_case() {
        let request = RequestEnvelope::parse_line(r#"{"protocol":1,"id":"c","method":"cluster_maintenance","params":{"room":"lab","operation":"rebuild","dryRun":true,"ifStale":true,"k":40}}"#).unwrap();
        let parsed = request.cluster_maintenance_request().unwrap();
        assert_eq!(parsed.operation(), ClusterMaintenanceOperation::Rebuild);
        assert!(parsed.dry_run());
        assert!(parsed.if_stale());
        assert_eq!(serde_json::to_string(&ClusterMaintenanceParams { room: "lab".into(), operation: "rebuild".into(), dry_run: true, if_stale: true, k: 40 }).unwrap(), r#"{"room":"lab","operation":"rebuild","dryRun":true,"ifStale":true,"k":40}"#);
        for bad in [serde_json::json!({"room":"lab","operation":"rebuild","k":0}), serde_json::json!({"room":"lab","operation":"rebuild","k":129}), serde_json::json!({"room":"lab","operation":"other","k":4}), serde_json::json!({"room":"lab","operation":"rebuild","extra":true})] {
            assert!(RequestEnvelope { protocol: 1, id: "c".into(), method: "cluster_maintenance".into(), params: bad }.cluster_maintenance_request().is_err());
        }
        assert!(RequestEnvelope { protocol: 1, id: "c".into(), method: "recall".into(), params: serde_json::json!({}) }.cluster_maintenance_request().is_err());
    }

    #[test]
    fn recall_cluster_telemetry_is_optional_and_compatible() {
        let telemetry: ClusterStalenessTelemetry = serde_json::from_value(serde_json::json!({"built_at":null,"chunks_since_build":250,"fraction_unseen":0.05})).unwrap();
        assert_eq!(telemetry.built_at, None);
        let resonance: ClusterResonanceTelemetry = serde_json::from_value(serde_json::json!({"profile":[{"label":"x","activation":0.9,"member_count":2}],"hot":["chunk"]})).unwrap();
        assert_eq!(resonance.profile[0].member_count, 2);
        assert!(serde_json::from_value::<ClusterStalenessTelemetry>(serde_json::json!({"built_at":null,"chunks_since_build":1,"fraction_unseen":0.1,"bad":true})).is_err());
    }
}

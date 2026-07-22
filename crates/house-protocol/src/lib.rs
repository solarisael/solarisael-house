//! Newline-delimited JSON wire protocol, version 1.

use house_core::{RememberKind, RememberReceipt, RememberRequest, RoomKey};
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
    #[serde(default = "default_backup")]
    pub backup: bool,
}

fn default_backup() -> bool { true }

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
pub struct ProtocolErrorBody {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct RememberResult {
    pub memory_id: u64,
    pub room: String,
    pub source_path: String,
    pub durable: bool,
    pub authority: String,
    pub warnings: Vec<String>,
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
        let mut supersedes = Vec::with_capacity(params.supersedes.len());
        for raw in params.supersedes {
            let id = raw.parse::<i64>().ok().filter(|&id| id > 0).ok_or_else(|| {
                ProtocolError::InvalidParams(format!("supersedes ID must be a positive PostgreSQL BIGINT decimal: {raw}"))
            })? as u64;
            if !supersedes.contains(&id) { supersedes.push(id); }
        }
        RememberRequest::new(room, kind, params.title, params.body, params.source_path, params.threads, supersedes, params.backup)
            .map_err(|e| ProtocolError::InvalidParams(e.to_string()))
    }
}

impl RequestEnvelope {
    pub fn remember_request(self) -> Result<RememberRequest, ProtocolError> {
        if self.protocol != PROTOCOL_VERSION { return Err(ProtocolError::ProtocolMismatch(self.protocol)); }
        if self.method != "remember" { return Err(ProtocolError::UnknownMethod(self.method)); }
        let params: RememberParams = serde_json::from_value(self.params)
            .map_err(|e| ProtocolError::InvalidParams(e.to_string()))?;
        params.try_into()
    }

    pub fn parse_line(line: &str) -> Result<Self, ProtocolError> {
        serde_json::from_str(line).map_err(|e| ProtocolError::Malformed(e.to_string()))
    }
}

impl From<RememberReceipt> for RememberResult {
    fn from(receipt: RememberReceipt) -> Self {
        Self { memory_id: receipt.memory_id(), room: receipt.room().to_string(), source_path: receipt.source_path().to_owned(), durable: true, authority: "postgres".into(), warnings: receipt.warnings().to_vec() }
    }
}

pub fn success<T>(id: impl Into<String>, result: T) -> ResponseEnvelope<T> {
    ResponseEnvelope { protocol: PROTOCOL_VERSION, id: id.into(), payload: ResponsePayload::Result { result } }
}

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
        let json = serde_json::to_string(&success("x", RememberResult { memory_id: 4, room: "lab".into(), source_path: "mem.md".into(), durable: true, authority: "postgres".into(), warnings: vec![] })).unwrap();
        assert_eq!(json, r#"{"protocol":1,"id":"x","result":{"memory_id":4,"room":"lab","source_path":"mem.md","durable":true,"authority":"postgres","warnings":[]}}"#);
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
        let params = RememberParams { room: "lab".into(), kind: "memory".into(), title: "T".into(), body: "B".into(), source_path: None, threads: vec![], supersedes: vec!["41".into(), "42".into(), "41".into()], backup: true };
        assert_eq!(RememberRequest::try_from(params).unwrap().supersedes(), &[41, 42]);
        let max = i64::MAX.to_string();
        let params = RememberParams { supersedes: vec![max], room: "lab".into(), kind: "memory".into(), title: "T".into(), body: "B".into(), source_path: None, threads: vec![], backup: true };
        assert_eq!(RememberRequest::try_from(params).unwrap().supersedes(), &[i64::MAX as u64]);
        for bad in ["0", "9223372036854775808", "nope"] {
            let params = RememberParams { supersedes: vec![bad.into()], room: "lab".into(), kind: "memory".into(), title: "T".into(), body: "B".into(), source_path: None, threads: vec![], backup: true };
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
}

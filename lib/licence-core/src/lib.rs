//! Pure offline lease verification. No network, device probing or UI dependencies.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Envelope { pub key_id: String, pub payload: String, pub signature: String }
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Lease {
    pub schema: u32, pub product: String, pub lease_id: String, pub licence_id: String,
    pub device_id: String, pub plan: String, pub features: Vec<String>,
    pub issued_at: u64, pub refresh_after: u64, pub expires_at: Option<u64>,
    pub updates_until: Option<u64>, pub revoked: bool,
}
#[derive(Debug, PartialEq)]
pub enum Access { Active, Expired, Revoked, UpdateRequired, ClockIncorrect }

pub fn verify(envelope: &Envelope, keys: &[(String, String)], device: &str) -> Result<Lease, String> {
    if envelope.payload.len() > 16384 || envelope.signature.len() > 100 { return Err("Invalid lease size.".into()); }
    let encoded_key = &keys.iter().find(|(id, _)| id == &envelope.key_id).ok_or("Unknown licence signing key.")?.1;
    let key_bytes: [u8; 32] = URL_SAFE_NO_PAD.decode(encoded_key).map_err(|_| "Invalid public key.")?.try_into().map_err(|_| "Invalid public key length.")?;
    let key = VerifyingKey::from_bytes(&key_bytes).map_err(|_| "Invalid public key.")?;
    let signature = Signature::from_slice(&URL_SAFE_NO_PAD.decode(&envelope.signature).map_err(|_| "Invalid lease signature.")?).map_err(|_| "Invalid lease signature.")?;
    let message = format!("quickque-lease-v1\n{}\n{}", envelope.key_id, envelope.payload);
    key.verify_strict(message.as_bytes(), &signature).map_err(|_| "Licence signature could not be verified.")?;
    let lease: Lease = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(&envelope.payload).map_err(|_| "Invalid lease payload.")?).map_err(|_| "Invalid lease claims.")?;
    if lease.schema != 1 || lease.product != "quickque" || lease.device_id != device || lease.licence_id.is_empty() || lease.lease_id.is_empty() {
        return Err("This licence lease does not belong to this Mac or application.".into());
    }
    if !["subscription", "perpetual"].contains(&lease.plan.as_str()) || lease.refresh_after < lease.issued_at ||
        (lease.plan == "subscription" && lease.expires_at.is_none()) ||
        lease.expires_at.is_some_and(|end| end <= lease.issued_at) ||
        lease.features.iter().any(|f| !["saved_audio", "voice_follow"].contains(&f.as_str())) {
        return Err("Invalid licence policy.".into());
    }
    Ok(lease)
}

pub fn access(lease: &Lease, now: u64, last_seen: u64, release_date: u64) -> Access {
    if lease.revoked { return Access::Revoked; }
    // A small tolerance accommodates ordinary clock correction, not an offline extension.
    if now.saturating_add(300) < last_seen || now.saturating_add(300) < lease.issued_at { return Access::ClockIncorrect; }
    if lease.expires_at.is_some_and(|end| now >= end) { return Access::Expired; }
    if lease.updates_until.is_some_and(|end| release_date > end) { return Access::UpdateRequired; }
    Access::Active
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    fn signed() -> (Envelope, Vec<(String,String)>) {
        let key = SigningKey::from_bytes(&[7;32]);
        let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&Lease { schema:1, product:"quickque".into(), lease_id:"lease".into(), licence_id:"purchase".into(), device_id:"mac-a".into(), plan:"subscription".into(), features:vec!["saved_audio".into()], issued_at:1000, refresh_after:1100, expires_at:Some(2000), updates_until:None, revoked:false }).unwrap());
        let signature = URL_SAFE_NO_PAD.encode(key.sign(format!("quickque-lease-v1\ntest\n{payload}").as_bytes()).to_bytes());
        (Envelope{key_id:"test".into(),payload,signature},vec![("test".into(),URL_SAFE_NO_PAD.encode(key.verifying_key().as_bytes()))])
    }
    #[test] fn accepts_a_real_node_issuer_signature() {
        let fixture: serde_json::Value=serde_json::from_str(include_str!("../fixtures/node-lease.json")).unwrap();
        let env: Envelope=serde_json::from_value(fixture["envelope"].clone()).unwrap();
        let keys: Vec<(String,String)>=serde_json::from_value(fixture["keys"].clone()).unwrap();
        let lease=verify(&env,&keys,fixture["device"].as_str().unwrap()).unwrap();
        assert_eq!(access(&lease,1500,1400,1000),Access::Active);
        assert_eq!(lease.licence_id,"cross-language-test");
    }
    #[test] fn verifies_signature_device_and_product_without_network() {
        let (mut env, keys) = signed();
        assert!(verify(&env,&keys,"mac-a").is_ok());
        assert!(verify(&env,&keys,"mac-b").is_err());
        env.payload.push('A'); assert!(verify(&env,&keys,"mac-a").is_err());
    }
    #[test] fn rejects_unknown_key_and_modified_signature() {
        let (mut env, keys) = signed(); env.key_id="other".into(); assert!(verify(&env,&keys,"mac-a").is_err());
        env.key_id="test".into(); env.signature=URL_SAFE_NO_PAD.encode([0;64]); assert!(verify(&env,&keys,"mac-a").is_err());
    }
    #[test] fn offline_expiry_revocation_and_clock_rollback() {
        let (env, keys)=signed(); let mut lease=verify(&env,&keys,"mac-a").unwrap();
        assert_eq!(access(&lease,1999,1500,1000),Access::Active);
        assert_eq!(access(&lease,2000,1500,1000),Access::Expired);
        assert_eq!(access(&lease,1000,1500,1000),Access::ClockIncorrect);
        lease.revoked=true; assert_eq!(access(&lease,1000,1000,1000),Access::Revoked);
    }
    #[test] fn perpetual_survives_expiry_of_updates_only_on_eligible_builds() {
        let (env, keys)=signed(); let mut lease=verify(&env,&keys,"mac-a").unwrap();
        lease.plan="perpetual".into(); lease.expires_at=None; lease.updates_until=Some(2000);
        assert_eq!(access(&lease,999999,999999,1999),Access::Active);
        assert_eq!(access(&lease,999999,999999,2001),Access::UpdateRequired);
        lease.updates_until=None; assert_eq!(access(&lease,999999,999999,2001),Access::Active);
    }
}
